-- =====================================================================
-- Resultados das cotações (economia) + alimentação na aprovação
--
-- Economia de cada item aprovado = (maior oferta recebida − valor aprovado)
--                                   × quantidade
-- =====================================================================
begin;

create table if not exists public.resultados_das_cotacoes (
  id                uuid primary key default gen_random_uuid(),
  cotacao_id        uuid not null references public.cotacoes(id) on delete cascade,
  cotacao_item_id   uuid references public.cotacao_itens(id) on delete set null,
  fornecedor_id     uuid not null references public.fornecedores(id),
  sku               text,
  descricao         text not null,
  quantidade        numeric(18,4) not null,
  unidade           text not null default 'un',
  valor_aprovado    numeric(18,4) not null check (valor_aprovado >= 0),
  valor_maximo      numeric(18,4) not null check (valor_maximo >= 0),
  economia_unitaria numeric(18,4) generated always as
                    (greatest(valor_maximo - valor_aprovado, 0)) stored,
  economia_total    numeric(18,2) generated always as
                    (round(greatest(valor_maximo - valor_aprovado, 0) * quantidade, 2)) stored,
  aprovado_em       timestamptz not null default now(),
  referencia        date not null,
  constraint resultados_das_cotacoes_unico unique (cotacao_id, cotacao_item_id)
);

create index if not exists resultados_das_cotacoes_referencia_idx
  on public.resultados_das_cotacoes (referencia);
create index if not exists resultados_das_cotacoes_fornecedor_idx
  on public.resultados_das_cotacoes (fornecedor_id);

alter table public.resultados_das_cotacoes enable row level security;

drop policy if exists "ler resultados_das_cotacoes" on public.resultados_das_cotacoes;
create policy "ler resultados_das_cotacoes" on public.resultados_das_cotacoes
  for select to authenticated
  using (tipo_usuario() in ('administrador', 'leitura'));

drop policy if exists "fornecedor le seus resultados" on public.resultados_das_cotacoes;
create policy "fornecedor le seus resultados" on public.resultados_das_cotacoes
  for select to authenticated
  using (tipo_usuario() = 'fornecedor' and fornecedor_id = fornecedor_do_usuario());

drop policy if exists "admin gerencia resultados_das_cotacoes" on public.resultados_das_cotacoes;
create policy "admin gerencia resultados_das_cotacoes" on public.resultados_das_cotacoes
  for all to authenticated
  using (tipo_usuario() = 'administrador')
  with check (tipo_usuario() = 'administrador');

revoke all on public.resultados_das_cotacoes from anon;

-- ---------------------------------------------------------------------
-- Aprovação passa a registrar a economia
-- ---------------------------------------------------------------------
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
  perform public.fn_exige_admin();

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

  -- refaz os resultados desta cotação
  delete from public.resultados_das_cotacoes where cotacao_id = p_cotacao_id;

  insert into public.resultados_das_cotacoes
    (cotacao_id, cotacao_item_id, fornecedor_id, sku, descricao, quantidade, unidade,
     valor_aprovado, valor_maximo, aprovado_em, referencia)
  select a.cotacao_id, a.cotacao_item_id, a.fornecedor_id, a.sku, a.descricao,
         a.quantidade, a.unidade,
         a.valor_de_custo_do_fornecedor,
         coalesce(m.maximo, a.valor_de_custo_do_fornecedor),
         a.aprovado_em,
         date_trunc('month', a.aprovado_em at time zone 'America/Sao_Paulo')::date
    from public.cotacoes_aprovadas a
    left join lateral (
      select max(cri.valor_unitario) as maximo
        from public.cotacao_respostas_itens cri
       where cri.cotacao_item_id = a.cotacao_item_id
         and cri.disponivel
    ) m on true
   where a.cotacao_id = p_cotacao_id;

  return jsonb_build_object(
    'cotacao_id', p_cotacao_id,
    'itens_aprovados', v_qtd,
    'total', (select coalesce(sum(valor_total), 0)
                from public.cotacoes_aprovadas where cotacao_id = p_cotacao_id),
    'economia', (select coalesce(sum(economia_total), 0)
                   from public.resultados_das_cotacoes where cotacao_id = p_cotacao_id));
end
$$;

-- ---------------------------------------------------------------------
-- Preenche o histórico a partir do que já foi aprovado
-- ---------------------------------------------------------------------
insert into public.resultados_das_cotacoes
  (cotacao_id, cotacao_item_id, fornecedor_id, sku, descricao, quantidade, unidade,
   valor_aprovado, valor_maximo, aprovado_em, referencia)
select a.cotacao_id, a.cotacao_item_id, a.fornecedor_id, a.sku, a.descricao,
       a.quantidade, a.unidade,
       a.valor_de_custo_do_fornecedor,
       coalesce(m.maximo, a.valor_de_custo_do_fornecedor),
       a.aprovado_em,
       date_trunc('month', a.aprovado_em at time zone 'America/Sao_Paulo')::date
  from public.cotacoes_aprovadas a
  left join lateral (
    select max(cri.valor_unitario) as maximo
      from public.cotacao_respostas_itens cri
     where cri.cotacao_item_id = a.cotacao_item_id
       and cri.disponivel
  ) m on true
on conflict (cotacao_id, cotacao_item_id) do nothing;

commit;
