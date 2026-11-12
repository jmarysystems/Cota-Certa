-- =====================================================================
-- Sistema de Cotação — endurecimento de permissões das funções
--
-- Motivo: no PostgreSQL toda função nasce com EXECUTE para PUBLIC, então
-- o `anon` conseguia chamar fn_aprovar_cotacao / fn_gerar_pedidos pela API.
-- Aqui (1) removemos o EXECUTE de PUBLIC, (2) concedemos só aos papéis
-- certos e (3) as funções administrativas passam a validar o perfil.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Guarda de perfil
-- ---------------------------------------------------------------------
create or replace function public.fn_exige_admin()
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if coalesce(public.tipo_usuario(), '') <> 'administrador' then
    raise exception 'Apenas administradores podem executar esta ação.' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Funções administrativas com validação embutida
-- ---------------------------------------------------------------------
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
  perform public.fn_exige_admin();

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
  perform public.fn_exige_admin();

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
  perform public.fn_exige_admin();

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

  return jsonb_build_object('cotacao_id', p_cotacao_id, 'itens_aprovados', v_qtd,
                            'total', (select coalesce(sum(valor_total), 0)
                                        from public.cotacoes_aprovadas
                                       where cotacao_id = p_cotacao_id));
end
$$;

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
  perform public.fn_exige_admin();

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

-- ---------------------------------------------------------------------
-- 3. Remove o EXECUTE implícito de PUBLIC e concede só aos papéis certos
-- ---------------------------------------------------------------------
revoke execute on function public.importar_skus_da_lista(text) from public;
revoke execute on function public.fn_importar_lista_para_cotacao(uuid, text) from public;
revoke execute on function public.fn_registrar_envio(uuid, uuid, text, text, text, text) from public;
revoke execute on function public.fn_aprovar_cotacao(uuid, jsonb) from public;
revoke execute on function public.fn_gerar_pedidos(uuid) from public;
revoke execute on function public.fn_cotacao_publica(uuid) from public;
revoke execute on function public.fn_responder_cotacao(uuid, text, jsonb, text, text, text, text) from public;
revoke execute on function public.fn_exige_admin() from public;
revoke execute on function public.fn_cotacao_codigo() from public;
revoke execute on function public.fn_recalcula_total_pedido() from public;
revoke execute on function public.fn_protege_admin_sistema() from public;
revoke execute on function public.tipo_usuario() from public;
revoke execute on function public.eh_admin_sistema() from public;
revoke execute on function public.fornecedor_do_usuario() from public;

-- usadas dentro das policies: precisam de EXECUTE para quem consulta
grant execute on function public.tipo_usuario() to authenticated, anon, service_role;
grant execute on function public.fornecedor_do_usuario() to authenticated, anon, service_role;
grant execute on function public.eh_admin_sistema() to authenticated, service_role;

-- administrativas
grant execute on function public.fn_exige_admin() to authenticated, service_role;
grant execute on function public.importar_skus_da_lista(text) to authenticated, service_role;
grant execute on function public.fn_importar_lista_para_cotacao(uuid, text) to authenticated, service_role;
grant execute on function public.fn_registrar_envio(uuid, uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.fn_aprovar_cotacao(uuid, jsonb) to authenticated, service_role;
grant execute on function public.fn_gerar_pedidos(uuid) to authenticated, service_role;

-- públicas (link do fornecedor) — únicas abertas ao anon
grant execute on function public.fn_cotacao_publica(uuid) to anon, authenticated, service_role;
grant execute on function public.fn_responder_cotacao(uuid, text, jsonb, text, text, text, text)
  to anon, authenticated, service_role;

commit;
