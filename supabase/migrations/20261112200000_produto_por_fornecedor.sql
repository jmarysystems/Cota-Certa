-- =====================================================================
-- Produtos por fornecedor: importação em lote e envio de cotação por vínculo
-- =====================================================================
begin;

create index if not exists produto_por_fornecedor_fornecedor_idx
  on public.produto_por_fornecedor (fornecedor_id);

-- ---------------------------------------------------------------------
-- Importa vínculos produto × fornecedor a partir de linhas de planilha.
-- Casa o fornecedor por CNPJ ou por razão social/nome fantasia e o produto
-- por SKU (cria o produto quando o SKU ainda não existe).
-- ---------------------------------------------------------------------
create or replace function public.fn_importar_produtos_por_fornecedor(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_linha record;
  v_produto uuid;
  v_fornecedor uuid;
  v_criados int := 0;
  v_vinculos int := 0;
  v_ignorados int := 0;
  v_sem_fornecedor jsonb := '[]'::jsonb;
  v_sem_sku jsonb := '[]'::jsonb;
begin
  perform public.fn_exige_admin();

  for v_linha in
    select * from jsonb_to_recordset(coalesce(p_linhas, '[]'::jsonb))
      as x(sku text, descricao text, unidade text, fornecedor text, cnpj text)
  loop
    if v_linha.sku is null or btrim(v_linha.sku) = '' then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;

    v_fornecedor := null;
    select f.id into v_fornecedor
      from public.fornecedores f
     where (
             v_linha.cnpj is not null and btrim(v_linha.cnpj) <> ''
             and regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g')
                 = regexp_replace(v_linha.cnpj, '\D', '', 'g')
           )
        or (
             v_linha.fornecedor is not null and btrim(v_linha.fornecedor) <> ''
             and (
               lower(btrim(f.razao_social)) = lower(btrim(v_linha.fornecedor))
               or lower(btrim(coalesce(f.nome_fantasia, ''))) = lower(btrim(v_linha.fornecedor))
             )
           )
     limit 1;

    if v_fornecedor is null then
      v_sem_fornecedor := v_sem_fornecedor
        || to_jsonb(coalesce(nullif(btrim(v_linha.fornecedor), ''),
                             nullif(btrim(v_linha.cnpj), ''), '(vazio)'));
      continue;
    end if;

    v_produto := null;
    select p.id into v_produto
      from public.produtos p
     where upper(btrim(p.sku)) = upper(btrim(v_linha.sku))
     limit 1;

    if v_produto is null then
      insert into public.produtos (sku, descricao, unidade, origem)
      values (upper(btrim(v_linha.sku)),
              coalesce(nullif(btrim(v_linha.descricao), ''), upper(btrim(v_linha.sku))),
              coalesce(nullif(btrim(v_linha.unidade), ''), 'un'),
              'importacao:produto_por_fornecedor')
      returning id into v_produto;
      v_criados := v_criados + 1;
    end if;

    insert into public.produto_por_fornecedor (produto_id, fornecedor_id)
    values (v_produto, v_fornecedor)
    on conflict (produto_id, fornecedor_id) do nothing;

    if found then
      v_vinculos := v_vinculos + 1;
    else
      v_sem_sku := v_sem_sku;
    end if;
  end loop;

  return jsonb_build_object(
    'vinculados', v_vinculos,
    'produtos_criados', v_criados,
    'sem_fornecedor', v_sem_fornecedor,
    'linhas_ignoradas', v_ignorados);
end
$$;

-- ---------------------------------------------------------------------
-- Quais fornecedores atendem os itens de uma cotação (pela tabela de vínculos).
-- ---------------------------------------------------------------------
create or replace function public.fn_fornecedores_da_cotacao(p_cotacao_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_total int := 0;
  v_sem jsonb := '[]'::jsonb;
  v_forn jsonb := '[]'::jsonb;
begin
  perform public.fn_exige_admin();

  with itens as (
    select distinct upper(btrim(sku)) as sku
      from public.cotacao_itens
     where cotacao_id = p_cotacao_id
       and sku is not null and btrim(sku) <> ''
  ), cobertura as (
    select pff.fornecedor_id, count(distinct i.sku)::int as cobertos
      from itens i
      join public.produtos p on upper(btrim(p.sku)) = i.sku
      join public.produto_por_fornecedor pff on pff.produto_id = p.id
     group by pff.fornecedor_id
  )
  select
    (select count(*)::int from itens),
    (select coalesce(jsonb_agg(sku order by sku), '[]'::jsonb)
       from itens i
      where not exists (
        select 1
          from public.produtos p
          join public.produto_por_fornecedor pff on pff.produto_id = p.id
         where upper(btrim(p.sku)) = i.sku)),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'fornecedor_id', f.id,
              'razao_social', f.razao_social,
              'contato_nome', f.contato_nome,
              'email', f.email,
              'whatsapp', f.whatsapp,
              'itens_cobertos', c.cobertos)
            order by c.cobertos desc, f.razao_social), '[]'::jsonb)
       from cobertura c
       join public.fornecedores f on f.id = c.fornecedor_id
      where f.ativo)
  into v_total, v_sem, v_forn;

  return jsonb_build_object('cotacao_id', p_cotacao_id,
                            'total_itens', v_total,
                            'itens_sem_fornecedor', v_sem,
                            'fornecedores', v_forn);
end
$$;

revoke execute on function public.fn_importar_produtos_por_fornecedor(jsonb) from public;
revoke execute on function public.fn_fornecedores_da_cotacao(uuid) from public;

grant execute on function public.fn_importar_produtos_por_fornecedor(jsonb)
  to authenticated, service_role;
grant execute on function public.fn_fornecedores_da_cotacao(uuid)
  to authenticated, service_role;

commit;
