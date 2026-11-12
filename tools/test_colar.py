"""Testa o payload que o botão 'Colar resposta' envia (transação revertida)."""

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
    forn = um("insert into public.fornecedores (razao_social, whatsapp) "
              "values ('Fornecedor Colar', '85981647015') returning id")["id"]
    cot = um("insert into public.cotacoes (titulo, prazo_resposta) "
             "values ('Cotação colar', now() + interval '1 day') returning id")["id"]
    itens = q(f"""
        insert into public.cotacao_itens (cotacao_id, sku, descricao, quantidade, unidade, ordem)
        values ('{cot}', '77', 'VEUVE CLICQUOT', 5, 'UN', 1),
               ('{cot}', '66', 'MOET', 5, 'UN', 2)
        returning id, sku
    """)
    q(f"insert into public.cotacao_envios (cotacao_id, fornecedor_id, canal, enviado_em) "
      f"values ('{cot}', '{forn}', 'whatsapp', now())")
    token = um(f"select token from public.cotacao_envios where cotacao_id = '{cot}'")["token"]

    # 77 com valor, 66 indisponível — igual ao que a tela monta
    payload = [
        {"cotacao_item_id": itens[0]["id"], "sku": "77", "descricao": "VEUVE CLICQUOT",
         "quantidade": 5, "unidade": "UN", "valor_unitario": 56, "disponivel": True},
        {"cotacao_item_id": itens[1]["id"], "sku": "66", "descricao": "MOET",
         "quantidade": 5, "unidade": "UN", "valor_unitario": 0, "disponivel": False},
    ]
    literal = json.dumps(payload).replace("'", "''")
    res = j(f"select public.fn_responder_cotacao('{token}', 'Fornecedor Colar', '{literal}'::jsonb) as r")
    print("registro:", res)
    assert res["total"] == 280, res
    assert res["itens"] == 2

    linhas = q(f"""
        select sku, valor_unitario, disponivel from public.cotacao_respostas_itens
         where resposta_id = '{res['resposta_id']}' order by sku
    """)
    for l in linhas:
        print("  ", l)

    print("\nsegunda tentativa deve ser bloqueada:")
    c.query("savepoint s")
    try:
        q(f"select public.fn_responder_cotacao('{token}', 'X', '{literal}'::jsonb)")
        print("  FALHA: aceitou resposta duplicada")
    except Exception as exc:
        print("  ok:", str(exc)[:70])
        c.query("rollback to savepoint s")

finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK — nada permaneceu.")
