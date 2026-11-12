-- =====================================================================
-- EAN nos produtos e nas listas importadas
-- =====================================================================
begin;

alter table public.produtos
  add column if not exists ean text;

-- Produtos já cadastrados: o EAN recebe o próprio SKU.
update public.produtos
   set ean = sku
 where ean is null or btrim(ean) = '';

alter table public.lista_de_produtos
  add column if not exists ean text;

create index if not exists produtos_ean_idx
  on public.produtos (upper(btrim(ean)));

-- ---------------------------------------------------------------------
-- Importação de lista passa a levar o EAN junto
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
           coalesce(nullif(btrim(unidade), ''), 'un') as unidade,
           nullif(btrim(ean), '') as ean
      from public.lista_de_produtos
     where lista = p_lista
       and sku is not null and btrim(sku) <> ''
     order by upper(btrim(sku)), ordem
  ), gravados as (
    insert into public.produtos (sku, descricao, unidade, ean, origem)
    select sku, descricao, unidade, ean, 'lista:' || p_lista from origem
    on conflict (upper(btrim(sku))) do update
       set descricao = excluded.descricao,
           unidade   = excluded.unidade,
           -- não sobrescreve um EAN já informado à mão
           ean       = coalesce(nullif(btrim(public.produtos.ean), ''), excluded.ean),
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

-- ---------------------------------------------------------------------
-- Importação de vínculos também aceita EAN
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
begin
  perform public.fn_exige_admin();

  for v_linha in
    select * from jsonb_to_recordset(coalesce(p_linhas, '[]'::jsonb))
      as x(sku text, descricao text, unidade text, ean text, fornecedor text, cnpj text)
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
      insert into public.produtos (sku, descricao, unidade, ean, origem)
      values (upper(btrim(v_linha.sku)),
              coalesce(nullif(btrim(v_linha.descricao), ''), upper(btrim(v_linha.sku))),
              coalesce(nullif(btrim(v_linha.unidade), ''), 'un'),
              coalesce(nullif(btrim(v_linha.ean), ''), upper(btrim(v_linha.sku))),
              'importacao:produto_por_fornecedor')
      returning id into v_produto;
      v_criados := v_criados + 1;
    end if;

    insert into public.produto_por_fornecedor (produto_id, fornecedor_id)
    values (v_produto, v_fornecedor)
    on conflict (produto_id, fornecedor_id) do nothing;

    if found then
      v_vinculos := v_vinculos + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'vinculados', v_vinculos,
    'produtos_criados', v_criados,
    'sem_fornecedor', v_sem_fornecedor,
    'linhas_ignoradas', v_ignorados);
end
$$;

commit;
