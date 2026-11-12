"""Testa a gravação de resultados na aprovação (transação revertida)."""

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
        values (gen_random_uuid(), 'admin.dash@cotacao.app', now(), now())
        returning id
    """)["id"]
    q(f"""
        insert into public.usuarios (auth_user_id, nome, cpf_cnpj, tipo, ativo)
        values ('{admin}', 'Admin', '11111111111', 'administrador', true)
    """)

    forns = q("""
        insert into public.fornecedores (razao_social, email)
        values ('Marina Carvalho', 'a@x.com'), ('jmarysystems0002', 'b@x.com')
        returning id, razao_social
    """)
    marina, beta = forns[0]["id"], forns[1]["id"]

    cot = um("""
        insert into public.cotacoes (titulo, prazo_resposta)
        values ('Cotação dashboard', now() + interval '1 day')
        returning id, codigo
    """)
    itens = q(f"""
        insert into public.cotacao_itens (cotacao_id, sku, descricao, quantidade, unidade, ordem)
        values ('{cot['id']}', '77', 'CHAMPAGNE VEUVE CLICQUOT BRUT', 5, 'UN', 1),
               ('{cot['id']}', '543', 'VINHO BRANCO MONTE PASCHOAL', 3, 'UN', 2)
        returning id, sku, descricao
    """)

    tokens = {}
    for fid in (marina, beta):
        q(f"""
            insert into public.cotacao_envios (cotacao_id, fornecedor_id, canal, enviado_em)
            values ('{cot['id']}', '{fid}', 'email', now())
        """)
        tokens[fid] = um(f"select token from public.cotacao_envios where cotacao_id = '{cot['id']}' and fornecedor_id = '{fid}'")["token"]

    precos = {marina: [56, 10], beta: [76, 12]}
    for fid in (marina, beta):
        carga = json.dumps([
            {"cotacao_item_id": it["id"], "sku": it["sku"], "descricao": it["descricao"],
             "quantidade": 5 if i == 0 else 3, "unidade": "UN",
             "valor_unitario": precos[fid][i], "disponivel": True}
            for i, it in enumerate(itens)
        ]).replace("'", "''")
        j(f"select public.fn_responder_cotacao('{tokens[fid]}', 'Empresa', '{carga}'::jsonb) as r")

    print("1) aprovando como administrador")
    c.query("reset role")
    c.query("set local role authenticated")
    c.query("set local request.jwt.claims = '%s'" % json.dumps({"sub": admin, "role": "authenticated"}))
    res = j(f"select public.fn_aprovar_cotacao('{cot['id']}') as r")
    print("   retorno:", res)

    c.query("reset role")
    print("\n2) linhas em resultados_das_cotacoes")
    for r in q(f"""
        select sku, descricao, quantidade, valor_aprovado, valor_maximo,
               economia_unitaria, economia_total, referencia
          from public.resultados_das_cotacoes
         where cotacao_id = '{cot['id']}'
         order by sku
    """):
        print(f"   {r['sku']:>4} qtd {r['quantidade']:>4} · aprovado {r['valor_aprovado']:>7} "
              f"· maior {r['valor_maximo']:>7} · economia un. {r['economia_unitaria']:>6} "
              f"· total {r['economia_total']:>7} · {r['referencia']}")

    total = um(f"select sum(economia_total) as s from public.resultados_das_cotacoes where cotacao_id = '{cot['id']}'")
    print("\n   economia da cotação:", total["s"], "(esperado 106.00)")

    print("\n3) re-aprovação não duplica")
    c.query("set local role authenticated")
    c.query("set local request.jwt.claims = '%s'" % json.dumps({"sub": admin, "role": "authenticated"}))
    j(f"select public.fn_aprovar_cotacao('{cot['id']}') as r")
    c.query("reset role")
    print("   linhas:", um(f"select count(*) as n from public.resultados_das_cotacoes where cotacao_id = '{cot['id']}'")["n"])

finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK — nada permaneceu.")
