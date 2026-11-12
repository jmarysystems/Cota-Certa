"""Testa a API do assistente (chave + telefone)."""

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


chave = um("select chave from public.config_assistente where id = 1")["chave"]
print("chave gerada:", chave[:8] + "…", "(", len(chave), "caracteres )")

try:
    c.query("begin")
    forn = um("""
        insert into public.fornecedores (razao_social, whatsapp)
        values ('Marina Carvalho', '85981647015') returning id
    """)["id"]
    cot = um("""
        insert into public.cotacoes (titulo, prazo_resposta)
        values ('Cotação WhatsApp', now() + interval '2 days')
        returning id, codigo
    """)
    itens = q(f"""
        insert into public.cotacao_itens (cotacao_id, sku, descricao, quantidade, unidade, ordem)
        values ('{cot['id']}', '77', 'VEUVE CLICQUOT', 5, 'UN', 1),
               ('{cot['id']}', '66', 'MOET', 5, 'UN', 2)
        returning id, sku
    """)
    q(f"""
        insert into public.cotacao_envios (cotacao_id, fornecedor_id, canal, enviado_em)
        values ('{cot['id']}', '{forn}', 'whatsapp', now())
    """)

    print("\n1) consulta por telefone (com +55 e 9º dígito)")
    for telefone in ("+55 85 98164-7015", "85981647015", "5585981647015"):
        r = j(f"select public.fn_assistente_cotacao('{chave}', '{telefone}') as r")
        nomes = [x["codigo"] for x in r.get("cotacoes", [])]
        print(f"   {telefone:20} encontrado={r['encontrado']} cotacoes={nomes}")

    print("\n2) telefone desconhecido")
    r = j(f"select public.fn_assistente_cotacao('{chave}', '11999999999') as r")
    print("  ", r)

    print("\n3) resposta por telefone")
    payload = [
        {"cotacao_item_id": itens[0]["id"], "sku": "77", "descricao": "VEUVE CLICQUOT",
         "quantidade": 5, "unidade": "UN", "valor_unitario": 56, "disponivel": True},
        {"cotacao_item_id": itens[1]["id"], "sku": "66", "descricao": "MOET",
         "quantidade": 5, "unidade": "UN", "valor_unitario": 0, "disponivel": False},
    ]
    literal = json.dumps(payload).replace("'", "''")
    res = j(f"""select public.fn_assistente_responder('{chave}', '85981647015',
                 '{cot['id']}', '{literal}'::jsonb) as r""")
    print("  ", res)
    assert res["total"] == 280

    print("\n4) outro telefone não pode responder por este fornecedor")
    c.query("savepoint s1")
    try:
        q(f"""select public.fn_assistente_responder('{chave}', '11999999999',
              '{cot['id']}', '{literal}'::jsonb)""")
        print("   FALHA: aceitou telefone de terceiro")
    except Exception as exc:
        print("   ok:", str(exc)[:80])
        c.query("rollback to savepoint s1")

    print("\n5) chave errada")
    c.query("savepoint s2")
    try:
        q(f"select public.fn_assistente_cotacao('chave-errada', '85981647015')")
        print("   FALHA: aceitou chave inválida")
    except Exception as exc:
        print("   ok:", str(exc)[:80])
        c.query("rollback to savepoint s2")

finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK — nada permaneceu.")
