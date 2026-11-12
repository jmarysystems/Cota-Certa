-- =====================================================================
-- Recebimento do pedido e nota fiscal
-- =====================================================================
begin;

alter table public.pedidos_gerados
  add column if not exists recebido boolean not null default false,
  add column if not exists recebido_em timestamptz,
  add column if not exists nota_fiscal text,
  add column if not exists nota_fiscal_em timestamptz;

alter table public.pedidos_gerados drop constraint if exists pedidos_gerados_nf_nao_vazia;
alter table public.pedidos_gerados add constraint pedidos_gerados_nf_nao_vazia
  check (nota_fiscal is null or btrim(nota_fiscal) <> '');

create index if not exists pedidos_gerados_recebido_idx
  on public.pedidos_gerados (recebido);

commit;
