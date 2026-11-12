-- =====================================================================
-- Sistema de Cotação — estrutura v2
-- Projeto Supabase: cowbpaaaguylhlvnlaac
-- Aplicar com: psql / driver Postgres (idempotente onde possível)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Helpers de perfil (reaproveita as funções já existentes)
--    admin_sistema herda tudo de administrador; a exclusividade dele é
--    garantida por índice único + trigger.
-- ---------------------------------------------------------------------
create or replace function public.tipo_usuario()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when tipo = 'admin_sistema' then 'administrador' else tipo end
  from public.usuarios
  where auth_user_id = auth.uid() and ativo
  limit 1
$$;

create or replace function public.eh_admin_sistema()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select tipo = 'admin_sistema' from public.usuarios
      where auth_user_id = auth.uid() and ativo limit 1), false)
$$;

-- ---------------------------------------------------------------------
-- 1. usuarios — quarto perfil, admin único e protegido
-- ---------------------------------------------------------------------
alter table public.usuarios drop constraint if exists usuarios_tipo_check;
alter table public.usuarios add constraint usuarios_tipo_check
  check (tipo in ('admin_sistema', 'administrador', 'leitura', 'fornecedor'));

alter table public.usuarios
  add column if not exists atualizado_em timestamptz not null default now();

-- Só pode existir um Administrador do Sistema.
create unique index if not exists usuarios_um_admin_sistema
  on public.usuarios (tipo) where tipo = 'admin_sistema';

create or replace function public.fn_protege_admin_sistema()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.tipo = 'admin_sistema' then
      raise exception 'O Administrador do Sistema não pode ser excluído.' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.tipo = 'admin_sistema' and new.tipo <> 'admin_sistema' then
    raise exception 'O Administrador do Sistema não pode ter o perfil alterado.' using errcode = '42501';
  end if;
  if old.tipo <> 'admin_sistema' and new.tipo = 'admin_sistema' then
    raise exception 'Já existe um Administrador do Sistema.' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_protege_admin_sistema on public.usuarios;
create trigger trg_protege_admin_sistema
  before update or delete on public.usuarios
  for each row execute function public.fn_protege_admin_sistema();

-- ---------------------------------------------------------------------
-- 2. fornecedores — dados comerciais usados na cotação e no pedido
-- ---------------------------------------------------------------------
alter table public.fornecedores
  add column if not exists prazo_entrega text,
  add column if not exists tipo_pagamento text,
  add column if not exists prazo_pagamento_dias integer,
  add column if not exists observacoes text,
  add column if not exists ativo boolean not null default true,
  add column if not exists atualizado_em timestamptz not null default now();

alter table public.fornecedores drop constraint if exists fornecedores_tipo_pagamento_check;
alter table public.fornecedores add constraint fornecedores_tipo_pagamento_check
  check (tipo_pagamento is null or tipo_pagamento in
         ('dinheiro', 'a_vista', 'boleto', 'pix', 'transferencia', 'cartao'));

alter table public.fornecedores drop constraint if exists fornecedores_prazo_pagamento_check;
alter table public.fornecedores add constraint fornecedores_prazo_pagamento_check
  check (prazo_pagamento_dias is null or prazo_pagamento_dias >= 0);

-- CNPJ/CPF sem máscara não se repete.
create unique index if not exists fornecedores_cnpj_cpf_uq
  on public.fornecedores (regexp_replace(cnpj_cpf, '\D', '', 'g'))
  where cnpj_cpf is not null and btrim(cnpj_cpf) <> '';

create index if not exists fornecedores_email_idx
  on public.fornecedores (lower(email));

-- ---------------------------------------------------------------------
-- 3. produtos — SKU único normalizado + origem da importação
-- ---------------------------------------------------------------------
alter table public.produtos
  add column if not exists atualizado_em timestamptz not null default now(),
  add column if not exists origem text not null default 'manual';

alter table public.produtos drop constraint if exists produtos_sku_key;
create unique index if not exists produtos_sku_uq
  on public.produtos (upper(btrim(sku)));

alter table public.produtos drop constraint if exists produtos_sku_nao_vazio;
alter table public.produtos add constraint produtos_sku_nao_vazio
  check (btrim(sku) <> '');

-- ---------------------------------------------------------------------
-- 4. lista_de_produtos — vínculo com produtos + importação
-- ---------------------------------------------------------------------
alter table public.lista_de_produtos
  add column if not exists produto_id uuid references public.produtos(id) on delete set null,
  add column if not exists importado_em timestamptz;

create index if not exists lista_de_produtos_lista_idx
  on public.lista_de_produtos (lista);

-- ---------------------------------------------------------------------
-- 5. cotacoes — código legível, status e autoria
-- ---------------------------------------------------------------------
create sequence if not exists public.cotacao_codigo_seq;

alter table public.cotacoes
  add column if not exists codigo text,
  add column if not exists status text not null default 'rascunho',
  add column if not exists criado_por uuid references public.usuarios(id) on delete set null,
  add column if not exists finalizada_em timestamptz,
  add column if not exists prazo_resposta date,
  add column if not exists atualizado_em timestamptz not null default now();

update public.cotacoes
   set codigo = 'COT-' || to_char(coalesce(criado_em, now()), 'YYYY') || '-' ||
                lpad(nextval('public.cotacao_codigo_seq')::text, 5, '0')
 where codigo is null;

alter table public.cotacoes alter column codigo set not null;
create unique index if not exists cotacoes_codigo_uq on public.cotacoes (codigo);

alter table public.cotacoes drop constraint if exists cotacoes_status_check;
alter table public.cotacoes add constraint cotacoes_status_check
  check (status in ('rascunho', 'finalizada', 'enviada', 'em_analise', 'aprovada', 'cancelada'));

create index if not exists cotacoes_status_idx on public.cotacoes (status);

create or replace function public.fn_cotacao_codigo()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is null or btrim(new.codigo) = '' then
    new.codigo := 'COT-' || to_char(now(), 'YYYY') || '-' ||
                  lpad(nextval('public.cotacao_codigo_seq')::text, 5, '0');
  end if;
  return new;
end
$$;

drop trigger if exists trg_cotacao_codigo on public.cotacoes;
create trigger trg_cotacao_codigo
  before insert on public.cotacoes
  for each row execute function public.fn_cotacao_codigo();

-- ---------------------------------------------------------------------
-- 6. cotacao_envios — quem recebeu / leu / respondeu + token público
-- ---------------------------------------------------------------------
alter table public.cotacao_envios
  add column if not exists token uuid not null default gen_random_uuid(),
  add column if not exists status text not null default 'enviado',
  add column if not exists respondido_em timestamptz,
  add column if not exists ultimo_envio_em timestamptz not null default now(),
  add column if not exists tentativas integer not null default 1,
  add column if not exists erro text,
  add column if not exists mensagem_id text;

alter table public.cotacao_envios drop constraint if exists cotacao_envios_status_check;
alter table public.cotacao_envios add constraint cotacao_envios_status_check
  check (status in ('pendente', 'enviado', 'entregue', 'lido', 'respondido', 'erro'));

create unique index if not exists cotacao_envios_token_uq
  on public.cotacao_envios (token);

-- Um registro por cotação/fornecedor/canal: reenvios incrementam tentativas.
create unique index if not exists cotacao_envios_cot_forn_canal_uq
  on public.cotacao_envios (cotacao_id, fornecedor_id, canal);

-- ---------------------------------------------------------------------
-- 7. cotacao_respostas_itens — resposta normalizada (base do ranking)
-- ---------------------------------------------------------------------
create table if not exists public.cotacao_respostas_itens (
  id                uuid primary key default gen_random_uuid(),
  resposta_id       uuid not null references public.cotacao_respostas(id) on delete cascade,
  cotacao_item_id   uuid references public.cotacao_itens(id) on delete set null,
  sku               text,
  descricao         text not null default '',
  quantidade        numeric(18,4) not null default 0,
  unidade           text not null default 'un',
  valor_unitario    numeric(18,4) not null check (valor_unitario >= 0),
  valor_total       numeric(18,2) generated always as (round(quantidade * valor_unitario, 2)) stored,
  disponivel        boolean not null default true,
  observacao        text,
  criado_em         timestamptz not null default now()
);

create index if not exists cotacao_respostas_itens_resposta_idx
  on public.cotacao_respostas_itens (resposta_id);
create index if not exists cotacao_respostas_itens_item_idx
  on public.cotacao_respostas_itens (cotacao_item_id);
create unique index if not exists cotacao_respostas_itens_unico
  on public.cotacao_respostas_itens (resposta_id, cotacao_item_id)
  where cotacao_item_id is not null;

-- ---------------------------------------------------------------------
-- 8. cotacoes_aprovadas — um vencedor por item
-- ---------------------------------------------------------------------
create table if not exists public.cotacoes_aprovadas (
  id                            uuid primary key default gen_random_uuid(),
  cotacao_id                    uuid not null references public.cotacoes(id) on delete cascade,
  cotacao_item_id               uuid references public.cotacao_itens(id) on delete set null,
  fornecedor_id                 uuid not null references public.fornecedores(id),
  resposta_item_id              uuid references public.cotacao_respostas_itens(id) on delete set null,
  sku                           text,
  descricao                     text not null,
  quantidade                    numeric(18,4) not null,
  unidade                       text not null default 'un',
  valor_de_custo_do_fornecedor  numeric(18,4) not null check (valor_de_custo_do_fornecedor >= 0),
  valor_total                   numeric(18,2) generated always as
                                (round(quantidade * valor_de_custo_do_fornecedor, 2)) stored,
  selecionado_automaticamente   boolean not null default true,
  aprovado_por                  uuid references public.usuarios(id) on delete set null,
  aprovado_em                   timestamptz not null default now(),
  observacao                    text,
  constraint cotacoes_aprovadas_unico_item unique (cotacao_id, cotacao_item_id)
);

create index if not exists cotacoes_aprovadas_cotacao_idx
  on public.cotacoes_aprovadas (cotacao_id);
create index if not exists cotacoes_aprovadas_fornecedor_idx
  on public.cotacoes_aprovadas (fornecedor_id);

-- ---------------------------------------------------------------------
-- 9. pedidos_gerados + pedido_itens
-- ---------------------------------------------------------------------
create sequence if not exists public.pedido_numero_seq;

create table if not exists public.pedidos_gerados (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null default ('PED-' || to_char(now(), 'YYYY') || '-' ||
                                        lpad(nextval('public.pedido_numero_seq')::text, 5, '0')),
  cotacao_id    uuid references public.cotacoes(id) on delete set null,
  fornecedor_id uuid not null references public.fornecedores(id),
  valor_total   numeric(18,2) not null default 0,
  data_pedido   date not null default current_date,
  status        text not null default 'gerado',
  canal_envio   text,
  enviado_em    timestamptz,
  enviado_para  text,
  observacao    text,
  criado_por    uuid references public.usuarios(id) on delete set null,
  criado_em     timestamptz not null default now()
);

alter table public.pedidos_gerados drop constraint if exists pedidos_gerados_status_check;
alter table public.pedidos_gerados add constraint pedidos_gerados_status_check
  check (status in ('gerado', 'enviado', 'confirmado', 'entregue', 'cancelado'));

alter table public.pedidos_gerados drop constraint if exists pedidos_gerados_canal_check;
alter table public.pedidos_gerados add constraint pedidos_gerados_canal_check
  check (canal_envio is null or canal_envio in ('email', 'whatsapp'));

create unique index if not exists pedidos_gerados_numero_uq on public.pedidos_gerados (numero);
create index if not exists pedidos_gerados_fornecedor_idx on public.pedidos_gerados (fornecedor_id);

create table if not exists public.pedido_itens (
  id                           uuid primary key default gen_random_uuid(),
  pedido_id                    uuid not null references public.pedidos_gerados(id) on delete cascade,
  cotacao_aprovada_id          uuid references public.cotacoes_aprovadas(id) on delete set null,
  sku                          text,
  descricao                    text not null,
  quantidade                   numeric(18,4) not null,
  unidade                      text not null default 'un',
  valor_de_custo_do_fornecedor numeric(18,4) not null check (valor_de_custo_do_fornecedor >= 0),
  valor_total                  numeric(18,2) generated always as
                               (round(quantidade * valor_de_custo_do_fornecedor, 2)) stored
);

create index if not exists pedido_itens_pedido_idx on public.pedido_itens (pedido_id);

create or replace function public.fn_recalcula_total_pedido()
returns trigger
language plpgsql
as $$
declare
  v_pedido uuid;
begin
  v_pedido := coalesce(new.pedido_id, old.pedido_id);
  update public.pedidos_gerados p
     set valor_total = coalesce((select sum(i.valor_total) from public.pedido_itens i
                                  where i.pedido_id = p.id), 0)
   where p.id = v_pedido;
  return null;
end
$$;

drop trigger if exists trg_recalcula_total_pedido on public.pedido_itens;
create trigger trg_recalcula_total_pedido
  after insert or update or delete on public.pedido_itens
  for each row execute function public.fn_recalcula_total_pedido();

-- ---------------------------------------------------------------------
-- 10. Funções de domínio
-- ---------------------------------------------------------------------

-- 10.1 Importa os SKUs de uma lista para a tabela produtos.
create or replace function public.importar_skus_da_lista(p_lista text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ins int := 0;
  v_upd int := 0;
begin
  with origem as (
    select distinct on (upper(btrim(sku)))
           upper(btrim(sku)) as sku,
           coalesce(nullif(btrim(descricao), ''), upper(btrim(sku))) as descricao,
           coalesce(nullif(btrim(unidade), ''), 'un') as unidade
      from public.lista_de_produtos
     where lista = p_lista
       and sku is not null and btrim(sku) <> ''
     order by upper(btrim(sku)), ordem
  ), gravados as (
    insert into public.produtos (sku, descricao, unidade, origem)
    select sku, descricao, unidade, 'lista:' || p_lista from origem
    on conflict (upper(btrim(sku))) do update
       set descricao = excluded.descricao,
           unidade   = excluded.unidade,
           atualizado_em = now()
    returning (xmax = 0) as inserido
  )
  select count(*) filter (where inserido),
         count(*) filter (where not inserido)
    into v_ins, v_upd
    from gravados;

  -- amarra as linhas da lista ao produto correspondente
  update public.lista_de_produtos l
     set produto_id = p.id,
         importado_em = now()
    from public.produtos p
   where l.lista = p_lista
     and l.sku is not null
     and p.sku = upper(btrim(l.sku));

  return jsonb_build_object('lista', p_lista, 'inseridos', v_ins,
                            'atualizados', v_upd, 'total', v_ins + v_upd);
end
$$;

-- 10.2 Importa uma lista inteira para os itens de uma cotação.
create or replace function public.fn_importar_lista_para_cotacao(p_cotacao_id uuid, p_lista text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prod jsonb;
  v_itens int := 0;
  v_base int;
begin
  v_prod := public.importar_skus_da_lista(p_lista);

  select coalesce(max(ordem), 0) into v_base
    from public.cotacao_itens where cotacao_id = p_cotacao_id;

  with origem as (
    select upper(btrim(sku)) as sku,
           coalesce(nullif(btrim(descricao), ''), upper(btrim(sku))) as descricao,
           coalesce(nullif(btrim(unidade), ''), 'un') as unidade,
           quantidade,
           row_number() over (order by ordem, descricao) as rn
      from public.lista_de_produtos
     where lista = p_lista
  )
  insert into public.cotacao_itens (cotacao_id, sku, descricao, quantidade, unidade, ordem)
  select p_cotacao_id, o.sku, o.descricao, o.quantidade, o.unidade, (v_base + o.rn)::int
    from origem o;

  get diagnostics v_itens = row_count;

  update public.cotacoes set atualizado_em = now() where id = p_cotacao_id;

  return jsonb_build_object('cotacao_id', p_cotacao_id, 'lista', p_lista,
                            'itens_importados', v_itens, 'produtos', v_prod);
end
$$;

-- 10.3 Registra/atualiza um envio (chamado depois de disparar e-mail/WhatsApp).
create or replace function public.fn_registrar_envio(
  p_cotacao_id uuid,
  p_fornecedor_id uuid,
  p_canal text,
  p_status text default 'enviado',
  p_erro text default null,
  p_mensagem_id text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  insert into public.cotacao_envios
    (cotacao_id, fornecedor_id, canal, enviado_em, enviado_por,
     status, ultimo_envio_em, erro, mensagem_id)
  values
    (p_cotacao_id, p_fornecedor_id, p_canal, now(),
     (select id from public.usuarios where auth_user_id = auth.uid() limit 1),
     p_status, now(), p_erro, p_mensagem_id)
  on conflict (cotacao_id, fornecedor_id, canal) do update
     set tentativas    = public.cotacao_envios.tentativas + 1,
         ultimo_envio_em = now(),
         enviado_em    = now(),
         status        = case when public.cotacao_envios.status = 'respondido'
                              then 'respondido' else excluded.status end,
         erro          = excluded.erro,
         mensagem_id   = coalesce(excluded.mensagem_id, public.cotacao_envios.mensagem_id),
         enviado_por   = coalesce(excluded.enviado_por, public.cotacao_envios.enviado_por)
  returning id into v_id;

  update public.cotacoes
     set status = 'enviada', atualizado_em = now()
   where id = p_cotacao_id and status in ('finalizada', 'rascunho');

  return v_id;
end
$$;

-- 10.4 Link público do fornecedor: lê a cotação pelo token.
create or replace function public.fn_cotacao_publica(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_out jsonb;
begin
  select jsonb_build_object(
           'cotacao', jsonb_build_object(
               'id', c.id, 'codigo', c.codigo, 'titulo', c.titulo,
               'observacao', c.observacao, 'status', c.status,
               'prazo_resposta', c.prazo_resposta),
           'fornecedor', jsonb_build_object(
               'id', f.id, 'nome', f.razao_social, 'contato', f.contato_nome,
               'email', f.email, 'whatsapp', f.whatsapp),
           'itens', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'cotacao_item_id', i.id, 'ordem', i.ordem, 'sku', i.sku,
                        'descricao', i.descricao, 'quantidade', i.quantidade,
                        'unidade', i.unidade) order by i.ordem)
                 from public.cotacao_itens i where i.cotacao_id = c.id), '[]'::jsonb),
           'ja_respondido', (e.status = 'respondido')
         )
    into v_out
    from public.cotacao_envios e
    join public.cotacoes c on c.id = e.cotacao_id
    left join public.fornecedores f on f.id = e.fornecedor_id
   where e.token = p_token;

  if v_out is null then
    raise exception 'Link inválido ou expirado.' using errcode = 'P0002';
  end if;

  update public.cotacao_envios
     set status = 'lido'
   where token = p_token and status = 'enviado';

  return v_out;
end
$$;

-- 10.5 Fornecedor responde pelo token (sem precisar de login).
create or replace function public.fn_responder_cotacao(
  p_token uuid,
  p_empresa text,
  p_itens jsonb,
  p_prazo_entrega text default null,
  p_pagamento text default null,
  p_validade text default null,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_envio record;
  v_resposta_id uuid;
  v_total numeric := 0;
  v_itens int := 0;
begin
  select * into v_envio from public.cotacao_envios where token = p_token;
  if not found then
    raise exception 'Link inválido ou expirado.' using errcode = 'P0002';
  end if;
  if v_envio.status = 'respondido' then
    raise exception 'Esta cotação já foi respondida.' using errcode = 'P0001';
  end if;

  insert into public.cotacao_respostas
    (cotacao_id, fornecedor_id, empresa, prazo_entrega, pagamento, validade, observacao, total, itens)
  values
    (v_envio.cotacao_id, v_envio.fornecedor_id, coalesce(p_empresa, ''), p_prazo_entrega,
     p_pagamento, p_validade, p_observacao, 0, coalesce(p_itens, '[]'::jsonb))
  returning id into v_resposta_id;

  insert into public.cotacao_respostas_itens
    (resposta_id, cotacao_item_id, sku, descricao, quantidade, unidade,
     valor_unitario, disponivel, observacao)
  select v_resposta_id,
         (e->>'cotacao_item_id')::uuid,
         e->>'sku',
         coalesce(e->>'descricao', ''),
         coalesce((e->>'quantidade')::numeric, 0),
         coalesce(nullif(e->>'unidade', ''), 'un'),
         (e->>'valor_unitario')::numeric,
         coalesce((e->>'disponivel')::boolean, true),
         e->>'observacao'
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e;

  get diagnostics v_itens = row_count;

  select coalesce(sum(valor_total), 0) into v_total
    from public.cotacao_respostas_itens where resposta_id = v_resposta_id;

  update public.cotacao_respostas set total = v_total where id = v_resposta_id;

  update public.cotacao_envios
     set status = 'respondido', respondido_em = now()
   where id = v_envio.id;

  update public.cotacoes
     set status = 'em_analise', atualizado_em = now()
   where id = v_envio.cotacao_id and status in ('finalizada', 'enviada');

  return jsonb_build_object('resposta_id', v_resposta_id, 'total', v_total, 'itens', v_itens);
end
$$;

-- 10.6 Aprova os vencedores (menor custo por item, ou escolha manual).
create or replace function public.fn_aprovar_cotacao(
  p_cotacao_id uuid,
  p_itens jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_qtd int := 0;
begin
  with escolhas as (
    select ci.id as item_id, ci.sku, ci.descricao, ci.quantidade, ci.unidade,
           r.resposta_item_id, r.fornecedor_id, r.valor_unitario
      from public.cotacao_itens ci
      join lateral (
        select cri.id as resposta_item_id, cr.fornecedor_id, cri.valor_unitario
          from public.cotacao_respostas_itens cri
          join public.cotacao_respostas cr on cr.id = cri.resposta_id
         where cri.cotacao_item_id = ci.id
           and cri.disponivel
           and (p_itens is null or exists (
                 select 1 from jsonb_array_elements(p_itens) x
                  where (x->>'cotacao_item_id')::uuid = ci.id
                    and (x->>'fornecedor_id')::uuid = cr.fornecedor_id))
         order by cri.valor_unitario, cr.criado_em
         limit 1
      ) r on true
     where ci.cotacao_id = p_cotacao_id
  )
  insert into public.cotacoes_aprovadas
    (cotacao_id, cotacao_item_id, fornecedor_id, resposta_item_id, sku, descricao,
     quantidade, unidade, valor_de_custo_do_fornecedor, selecionado_automaticamente, aprovado_por)
  select p_cotacao_id, item_id, fornecedor_id, resposta_item_id, sku, descricao,
         quantidade, unidade, valor_unitario, (p_itens is null),
         (select id from public.usuarios where auth_user_id = auth.uid() limit 1)
    from escolhas
  on conflict (cotacao_id, cotacao_item_id) do update
     set fornecedor_id = excluded.fornecedor_id,
         resposta_item_id = excluded.resposta_item_id,
         valor_de_custo_do_fornecedor = excluded.valor_de_custo_do_fornecedor,
         selecionado_automaticamente = excluded.selecionado_automaticamente,
         aprovado_por = excluded.aprovado_por,
         aprovado_em = now();

  get diagnostics v_qtd = row_count;

  update public.cotacoes
     set status = 'aprovada', atualizado_em = now()
   where id = p_cotacao_id and status <> 'cancelada';

  return jsonb_build_object('cotacao_id', p_cotacao_id, 'itens_aprovados', v_qtd,
                            'total', (select coalesce(sum(valor_total), 0)
                                        from public.cotacoes_aprovadas
                                       where cotacao_id = p_cotacao_id));
end
$$;

-- 10.7 Gera um pedido por fornecedor a partir das aprovações.
create or replace function public.fn_gerar_pedidos(p_cotacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_forn record;
  v_pedido uuid;
  v_lista jsonb := '[]'::jsonb;
  v_total numeric;
  v_numero text;
begin
  for v_forn in
    select distinct fornecedor_id from public.cotacoes_aprovadas where cotacao_id = p_cotacao_id
  loop
    select id into v_pedido from public.pedidos_gerados
     where cotacao_id = p_cotacao_id and fornecedor_id = v_forn.fornecedor_id;

    if v_pedido is null then
      insert into public.pedidos_gerados (cotacao_id, fornecedor_id, criado_por)
      values (p_cotacao_id, v_forn.fornecedor_id,
              (select id from public.usuarios where auth_user_id = auth.uid() limit 1))
      returning id, numero into v_pedido, v_numero;

      insert into public.pedido_itens
        (pedido_id, cotacao_aprovada_id, sku, descricao, quantidade, unidade,
         valor_de_custo_do_fornecedor)
      select v_pedido, a.id, a.sku, a.descricao, a.quantidade, a.unidade,
             a.valor_de_custo_do_fornecedor
        from public.cotacoes_aprovadas a
       where a.cotacao_id = p_cotacao_id and a.fornecedor_id = v_forn.fornecedor_id;
    else
      select numero into v_numero from public.pedidos_gerados where id = v_pedido;
    end if;

    select valor_total into v_total from public.pedidos_gerados where id = v_pedido;

    v_lista := v_lista || jsonb_build_object(
      'pedido_id', v_pedido, 'numero', v_numero,
      'fornecedor_id', v_forn.fornecedor_id, 'valor_total', v_total);
  end loop;

  return jsonb_build_object('cotacao_id', p_cotacao_id, 'pedidos', v_lista);
end
$$;

-- 10.8 Funil de respostas por fornecedor (o "quem recebeu / quem respondeu").
create or replace view public.vw_cotacao_fornecedor_status
with (security_invoker = true) as
select c.id  as cotacao_id,
       c.codigo,
       c.titulo,
       c.status as status_cotacao,
       f.id  as fornecedor_id,
       f.razao_social as fornecedor,
       bool_or(e.canal = 'email')    as recebeu_email,
       bool_or(e.canal = 'whatsapp') as recebeu_whatsapp,
       max(e.ultimo_envio_em)        as ultimo_envio_em,
       sum(e.tentativas)             as tentativas,
       bool_or(e.status = 'respondido') as respondeu,
       max(e.respondido_em)          as respondido_em,
       (select count(*) from public.cotacao_respostas r
         where r.cotacao_id = c.id and r.fornecedor_id = f.id) as respostas
  from public.cotacoes c
  join public.cotacao_envios e on e.cotacao_id = c.id
  join public.fornecedores f   on f.id = e.fornecedor_id
 group by c.id, c.codigo, c.titulo, c.status, f.id, f.razao_social;

-- 10.9 Ranking de ofertas por item (menor custo primeiro).
create or replace view public.vw_resultado_cotacao
with (security_invoker = true) as
select ci.cotacao_id,
       ci.id as cotacao_item_id,
       ci.ordem,
       ci.sku,
       ci.descricao,
       ci.quantidade,
       ci.unidade,
       cr.fornecedor_id,
       f.razao_social as fornecedor,
       cri.id as resposta_item_id,
       cri.valor_unitario,
       cri.valor_total,
       cri.disponivel,
       row_number() over (partition by ci.id
                          order by cri.valor_unitario, cr.criado_em) as posicao,
       min(cri.valor_unitario) over (partition by ci.id) as menor_valor_unitario
  from public.cotacao_itens ci
  join public.cotacao_respostas_itens cri on cri.cotacao_item_id = ci.id and cri.disponivel
  join public.cotacao_respostas cr on cr.id = cri.resposta_id
  left join public.fornecedores f on f.id = cr.fornecedor_id;

-- ---------------------------------------------------------------------
-- 11. RLS nas tabelas novas
-- ---------------------------------------------------------------------
alter table public.cotacao_respostas_itens enable row level security;
alter table public.cotacoes_aprovadas     enable row level security;
alter table public.pedidos_gerados        enable row level security;
alter table public.pedido_itens           enable row level security;

-- cotacao_respostas_itens
drop policy if exists "ler cotacao_respostas_itens"        on public.cotacao_respostas_itens;
drop policy if exists "fornecedor le itens da sua resposta" on public.cotacao_respostas_itens;
drop policy if exists "admin gerencia cotacao_respostas_itens" on public.cotacao_respostas_itens;

create policy "ler cotacao_respostas_itens" on public.cotacao_respostas_itens
  for select to authenticated
  using (tipo_usuario() in ('administrador', 'leitura'));

create policy "fornecedor le itens da sua resposta" on public.cotacao_respostas_itens
  for select to authenticated
  using (tipo_usuario() = 'fornecedor' and exists (
           select 1 from public.cotacao_respostas r
            where r.id = resposta_id and r.fornecedor_id = fornecedor_do_usuario()));

create policy "admin gerencia cotacao_respostas_itens" on public.cotacao_respostas_itens
  for all to authenticated
  using (tipo_usuario() = 'administrador')
  with check (tipo_usuario() = 'administrador');

-- cotacoes_aprovadas
drop policy if exists "ler cotacoes_aprovadas" on public.cotacoes_aprovadas;
drop policy if exists "fornecedor le suas aprovacoes" on public.cotacoes_aprovadas;
drop policy if exists "admin gerencia cotacoes_aprovadas" on public.cotacoes_aprovadas;

create policy "ler cotacoes_aprovadas" on public.cotacoes_aprovadas
  for select to authenticated
  using (tipo_usuario() in ('administrador', 'leitura'));

create policy "fornecedor le suas aprovacoes" on public.cotacoes_aprovadas
  for select to authenticated
  using (tipo_usuario() = 'fornecedor' and fornecedor_id = fornecedor_do_usuario());

create policy "admin gerencia cotacoes_aprovadas" on public.cotacoes_aprovadas
  for all to authenticated
  using (tipo_usuario() = 'administrador')
  with check (tipo_usuario() = 'administrador');

-- pedidos_gerados
drop policy if exists "ler pedidos_gerados" on public.pedidos_gerados;
drop policy if exists "fornecedor le seus pedidos" on public.pedidos_gerados;
drop policy if exists "admin gerencia pedidos_gerados" on public.pedidos_gerados;

create policy "ler pedidos_gerados" on public.pedidos_gerados
  for select to authenticated
  using (tipo_usuario() in ('administrador', 'leitura'));

create policy "fornecedor le seus pedidos" on public.pedidos_gerados
  for select to authenticated
  using (tipo_usuario() = 'fornecedor' and fornecedor_id = fornecedor_do_usuario());

create policy "admin gerencia pedidos_gerados" on public.pedidos_gerados
  for all to authenticated
  using (tipo_usuario() = 'administrador')
  with check (tipo_usuario() = 'administrador');

-- pedido_itens
drop policy if exists "ler pedido_itens" on public.pedido_itens;
drop policy if exists "fornecedor le itens dos seus pedidos" on public.pedido_itens;
drop policy if exists "admin gerencia pedido_itens" on public.pedido_itens;

create policy "ler pedido_itens" on public.pedido_itens
  for select to authenticated
  using (tipo_usuario() in ('administrador', 'leitura'));

create policy "fornecedor le itens dos seus pedidos" on public.pedido_itens
  for select to authenticated
  using (tipo_usuario() = 'fornecedor' and exists (
           select 1 from public.pedidos_gerados p
            where p.id = pedido_id and p.fornecedor_id = fornecedor_do_usuario()));

create policy "admin gerencia pedido_itens" on public.pedido_itens
  for all to authenticated
  using (tipo_usuario() = 'administrador')
  with check (tipo_usuario() = 'administrador');

-- ---------------------------------------------------------------------
-- 12. Correções nas policies existentes
-- ---------------------------------------------------------------------

-- 12.1 anon não lê mais a base inteira de cotações: o acesso público
--      passa a ser exclusivamente pelos RPCs com token.
drop policy if exists "le cotacoes" on public.cotacoes;
drop policy if exists "le itens"   on public.cotacao_itens;
drop policy if exists "envia respostas" on public.cotacao_respostas;

create policy "ler cotacoes" on public.cotacoes
  for select to authenticated
  using (tipo_usuario() in ('administrador', 'leitura'));

create policy "fornecedor le suas cotacoes" on public.cotacoes
  for select to authenticated
  using (tipo_usuario() = 'fornecedor' and exists (
           select 1 from public.cotacao_envios e
            where e.cotacao_id = cotacoes.id
              and e.fornecedor_id = fornecedor_do_usuario()));

create policy "ler cotacao_itens" on public.cotacao_itens
  for select to authenticated
  using (tipo_usuario() in ('administrador', 'leitura'));

create policy "fornecedor le itens das suas cotacoes" on public.cotacao_itens
  for select to authenticated
  using (tipo_usuario() = 'fornecedor' and exists (
           select 1 from public.cotacao_envios e
            where e.cotacao_id = cotacao_itens.cotacao_id
              and e.fornecedor_id = fornecedor_do_usuario()));

create policy "admin cadastra respostas" on public.cotacao_respostas
  for insert to authenticated
  with check (tipo_usuario() = 'administrador');

-- 12.2 fornecedor enxerga o próprio cadastro
drop policy if exists "fornecedor le seu cadastro" on public.fornecedores;
create policy "fornecedor le seu cadastro" on public.fornecedores
  for select to authenticated
  using (tipo_usuario() = 'fornecedor' and id = fornecedor_do_usuario());

-- 12.3 usuarios: admin_sistema e leitura também enxergam; admin cadastra e exclui
drop policy if exists "ver proprio usuario ou admin" on public.usuarios;
create policy "ver proprio usuario ou admin" on public.usuarios
  for select to authenticated
  using (auth_user_id = auth.uid() or tipo_usuario() in ('administrador', 'leitura'));

drop policy if exists "admin cadastra usuarios" on public.usuarios;
create policy "admin cadastra usuarios" on public.usuarios
  for insert to authenticated
  with check (tipo_usuario() = 'administrador');

drop policy if exists "admin exclui usuarios" on public.usuarios;
create policy "admin exclui usuarios" on public.usuarios
  for delete to authenticated
  using (tipo_usuario() = 'administrador');

-- 12.4 admin_sistema passa nas policies de "administrador"
drop policy if exists "admin edita usuarios" on public.usuarios;
create policy "admin edita usuarios" on public.usuarios
  for update to authenticated
  using (tipo_usuario() = 'administrador')
  with check (tipo_usuario() = 'administrador');

-- ---------------------------------------------------------------------
-- 13. Grants: anon só tem acesso pelos RPCs
-- ---------------------------------------------------------------------
revoke all on public.cotacoes            from anon;
revoke all on public.cotacao_itens       from anon;
revoke all on public.cotacao_respostas   from anon;
revoke all on public.cotacao_envios      from anon;
revoke all on public.fornecedores        from anon;
revoke all on public.produtos            from anon;
revoke all on public.produto_por_fornecedor from anon;
revoke all on public.lista_de_produtos   from anon;
revoke all on public.usuarios            from anon;
revoke all on public.cotacao_respostas_itens from anon;
revoke all on public.cotacoes_aprovadas  from anon;
revoke all on public.pedidos_gerados     from anon;
revoke all on public.pedido_itens        from anon;

grant execute on function public.fn_cotacao_publica(uuid) to anon, authenticated;
grant execute on function public.fn_responder_cotacao(uuid, text, jsonb, text, text, text, text)
  to anon, authenticated;
grant execute on function public.fn_cotacao_codigo() to authenticated;
grant execute on function public.importar_skus_da_lista(text) to authenticated;
grant execute on function public.fn_importar_lista_para_cotacao(uuid, text) to authenticated;
grant execute on function public.fn_registrar_envio(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.fn_aprovar_cotacao(uuid, jsonb) to authenticated;
grant execute on function public.fn_gerar_pedidos(uuid) to authenticated;

grant usage, select on sequence public.cotacao_codigo_seq to authenticated;
grant usage, select on sequence public.pedido_numero_seq to authenticated;

commit;
