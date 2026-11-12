"""Testa a importação de EAN (transação revertida)."""

import json

from pgclient import connect_from_dsn

c = connect_from_dsn()


def q(sql):
    return c.query(sql)["rows"]


def um(sql):
    linhas = q(sql)
    return linhas[0] if linhas else None


def j(sql):
    return json.loads(um(sql)["r"])


try:
    c.query("begin")
    admin = um("""
        insert into auth.users (id, email, created_at, updated_at)
        values (gen_random_uuid(), 'admin.ean@cotacao.app', now(), now())
        returning id
    """)["id"]
    q(f"""
        insert into public.usuarios (auth_user_id, nome, cpf_cnpj, tipo, ativo)
        values ('{admin}', 'Admin', '11111111111', 'administrador', true)
    """)
    forn = um("""
        insert into public.fornecedores (razao_social, cnpj_cpf)
        values ('Alfa EAN', '11222333000181') returning id
    """)["id"]

    q("""
        insert into public.lista_de_produtos (lista, sku, ean, descricao, quantidade, unidade, ordem)
        values ('Lista EAN', 'sku-e1', '7891000100103', 'Produto E1', 10, 'un', 1),
               ('Lista EAN', 'SKU-E2', null,          'Produto E2', 20, 'un', 2)
    """)

    c.query("reset role")
    c.query("set local role authenticated")
    c.query("set local request.jwt.claims = '%s'" % json.dumps({"sub": admin, "role": "authenticated"}))

    res = j("select public.importar_skus_da_lista('Lista EAN') as r")
    print("1) importar_skus_da_lista:", res)

    c.query("reset role")
    for p in q("select sku, ean from public.produtos where sku like 'SKU-E%' order by sku"):
        print(f"   {p['sku']} -> ean {p['ean']}")

    print("\n2) EAN não sobrescreve valor manual")
    q("update public.produtos set ean = 'MANUAL123' where sku = 'SKU-E1'")
    c.query("set local role authenticated")
    c.query("set local request.jwt.claims = '%s'" % json.dumps({"sub": admin, "role": "authenticated"}))
    j("select public.importar_skus_da_lista('Lista EAN') as r")
    c.query("reset role")
    print("   SKU-E1:", um("select ean from public.produtos where sku = 'SKU-E1'")["ean"])

    print("\n3) importação por fornecedor com EAN")
    c.query("set local role authenticated")
    c.query("set local request.jwt.claims = '%s'" % json.dumps({"sub": admin, "role": "authenticated"}))
    linhas = [{"sku": "SKU-E9", "descricao": "Produto novo", "unidade": "un",
               "ean": "7899999000011", "fornecedor": "Alfa EAN"}]
    literal = json.dumps(linhas).replace("'", "''")
    res2 = j(f"select public.fn_importar_produtos_por_fornecedor('{literal}'::jsonb) as r")
    print("   resultado:", res2)
    c.query("reset role")
    print("   SKU-E9:", um("select sku, ean from public.produtos where sku = 'SKU-E9'"))

finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK — nada permaneceu.")
