-- =====================================================================
-- API do assistente (canal por mensagem)
--
-- Duas funções para um assistente externo (OpenClaw, WhatsApp Cloud API,
-- n8n) operar em nome do fornecedor, autenticadas por uma chave própria.
-- A gravação continua sendo fn_responder_cotacao, então prazo, bloqueio de
-- resposta duplicada e cálculo do total seguem valendo.
-- =====================================================================
begin;

create table if not exists public.config_assistente (
  id          integer primary key default 1 check (id = 1),
  chave       text not null default encode(gen_random_bytes(24), 'hex'),
  criado_em   timestamptz not null default now()
);

alter table public.config_assistente enable row level security;
revoke all on public.config_assistente from anon, authenticated;

insert into public.config_assistente (id) values (1)
on conflict (id) do nothing;

create or replace function public.fn_assistente_autorizado(p_chave text)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_chave is null or p_chave <> (select chave from public.config_assistente where id = 1) then
    raise exception 'Chave do assistente inválida.' using errcode = '42501';
  end if;
end
$$;

-- Normaliza telefone comparando só os dígitos e tolerando 55 e o 9º dígito.
create or replace function public.fn_normaliza_telefone(p_telefone text)
returns text
language sql
immutable
as $$
  select right(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), 11)
$$;

-- ---------------------------------------------------------------------
-- Cotação aberta do telefone (o que o assistente precisa para perguntar)
-- ---------------------------------------------------------------------
create or replace function public.fn_assistente_cotacao(p_chave text, p_telefone text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_doc text;
  v_fornecedores int := 0;
  v_cotacoes jsonb := '[]'::jsonb;
begin
  perform public.fn_assistente_autorizado(p_chave);

  v_doc := public.fn_normaliza_telefone(p_telefone);
  if v_doc = '' then
    return jsonb_build_object('encontrado', false, 'motivo', 'telefone vazio');
  end if;

  select count(*) into v_fornecedores
    from public.fornecedores f
   where f.ativo and public.fn_normaliza_telefone(f.whatsapp) = v_doc;

  if v_fornecedores = 0 then
    return jsonb_build_object('encontrado', false, 'motivo', 'telefone não é de fornecedor');
  end if;

  -- Pode haver mais de um cadastro com o mesmo telefone: devolve tudo.
  select coalesce(jsonb_agg(q.obj order by q.criado_em desc), '[]'::jsonb)
    into v_cotacoes
    from (
      select c.criado_em,
             jsonb_build_object(
               'cotacao_id', c.id,
               'codigo', c.codigo,
               'titulo', c.titulo,
               'fornecedor', f.razao_social,
               'fornecedor_id', f.id,
               'prazo_resposta', c.prazo_resposta,
               'prazo_encerrado', (c.prazo_resposta is not null and now() > c.prazo_resposta),
               'itens', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'cotacao_item_id', i.id, 'sku', i.sku,
                           'descricao', i.descricao,
                           'quantidade', i.quantidade, 'unidade', i.unidade)
                         order by i.ordem)
                    from public.cotacao_itens i where i.cotacao_id = c.id), '[]'::jsonb)
             ) as obj
        from public.cotacao_envios e
        join public.cotacoes c on c.id = e.cotacao_id
        join public.fornecedores f on f.id = e.fornecedor_id
       where f.ativo
         and public.fn_normaliza_telefone(f.whatsapp) = v_doc
         and e.status <> 'respondido'
         and c.status not in ('aprovada', 'cancelada')
    ) q;

  return jsonb_build_object('encontrado', true,
                            'fornecedores_com_este_telefone', v_fornecedores,
                            'cotacoes', v_cotacoes);
end
$$;

-- ---------------------------------------------------------------------
-- Registrar a resposta vinda por mensagem
-- ---------------------------------------------------------------------
create or replace function public.fn_assistente_responder(
  p_chave text,
  p_telefone text,
  p_cotacao_id uuid,
  p_itens jsonb,
  p_empresa text default null,
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
  v_doc text;
  v_envio record;
  v_quantos int := 0;
begin
  perform public.fn_assistente_autorizado(p_chave);

  v_doc := public.fn_normaliza_telefone(p_telefone);

  select count(*) into v_quantos
    from public.cotacao_envios e
    join public.fornecedores f on f.id = e.fornecedor_id
   where e.cotacao_id = p_cotacao_id
     and f.ativo
     and public.fn_normaliza_telefone(f.whatsapp) = v_doc;

  if v_quantos = 0 then
    raise exception 'Este telefone não tem envio nesta cotação.' using errcode = '42501';
  end if;
  if v_quantos > 1 then
    raise exception 'Este telefone está em mais de um fornecedor; ajuste o cadastro antes de usar o assistente.'
      using errcode = 'P0001';
  end if;

  select e.*, f.razao_social
    into v_envio
    from public.cotacao_envios e
    join public.fornecedores f on f.id = e.fornecedor_id
   where e.cotacao_id = p_cotacao_id
     and f.ativo
     and public.fn_normaliza_telefone(f.whatsapp) = v_doc
   limit 1;

  if not found then
    raise exception 'Este telefone não tem envio nesta cotação.' using errcode = '42501';
  end if;

  return public.fn_responder_cotacao(
    v_envio.token,
    coalesce(p_empresa, v_envio.razao_social),
    p_itens,
    p_prazo_entrega,
    p_pagamento,
    p_validade,
    p_observacao
  );
end
$$;

revoke execute on function public.fn_assistente_autorizado(text) from public;
revoke execute on function public.fn_assistente_cotacao(text, text) from public;
revoke execute on function public.fn_assistente_responder(text, text, uuid, jsonb, text, text, text, text, text) from public;

grant execute on function public.fn_assistente_cotacao(text, text) to anon, authenticated, service_role;
grant execute on function public.fn_assistente_responder(text, text, uuid, jsonb, text, text, text, text, text)
  to anon, authenticated, service_role;

commit;
