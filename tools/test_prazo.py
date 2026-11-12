"""Testa o prazo com data/hora e o bloqueio de resposta (transação revertida)."""

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
    forn = q("""
        insert into public.fornecedores (razao_social, email, whatsapp)
        values ('Fornecedor Prazo', 'prazo@x.com', '11988880001')
        returning id
    """)[0]["id"]

    def montar(prazo_sql):
        cot = um(f"""
            insert into public.cotacoes (titulo, prazo_resposta)
            values ('Cotação prazo', {prazo_sql})
            returning id, codigo, prazo_resposta
        """)
        q(f"""
            insert into public.cotacao_itens (cotacao_id, sku, descricao, quantidade, unidade, ordem)
            values ('{cot['id']}', 'SKU-P1', 'Item', 10, 'un', 1)
        """)
        q(f"""
            insert into public.cotacao_envios (cotacao_id, fornecedor_id, canal, enviado_em)
            values ('{cot['id']}', '{forn}', 'email', now())
        """)
        token = um(f"select token from public.cotacao_envios where cotacao_id = '{cot['id']}'")["token"]
        item = um(f"select id from public.cotacao_itens where cotacao_id = '{cot['id']}'")
        return cot, token, item["id"]

    # 1) prazo no passado
    print("1) cotação com prazo vencido")
    cot_passado, token_passado, item_passado = montar("now() - interval '1 hour'")
    print("   prazo:", cot_passado["prazo_resposta"])

    pub = j(f"select public.fn_cotacao_publica('{token_passado}') as r")
    print("   prazo_encerrado no link:", pub["cotacao"]["prazo_encerrado"])

    carga = json.dumps([{
        "cotacao_item_id": item_passado, "sku": "SKU-P1", "descricao": "Item",
        "quantidade": 10, "unidade": "un", "valor_unitario": 5, "disponivel": True,
    }]).replace("'", "''")

    c.query("savepoint s1")
    try:
        q(f"select public.fn_responder_cotacao('{token_passado}', 'Empresa', '{carga}'::jsonb)")
        print("   FALHA: aceitou resposta vencida")
    except Exception as exc:
        print("   ok, bloqueado:", str(exc)[:95])
        c.query("rollback to savepoint s1")

    # 2) prazo no futuro
    print("\n2) cotação com prazo futuro")
    cot_futuro, token_futuro, item_futuro = montar("now() + interval '2 hours'")
    pub2 = j(f"select public.fn_cotacao_publica('{token_futuro}') as r")
    print("   prazo:", pub2["cotacao"]["prazo_resposta"], "| encerrado:", pub2["cotacao"]["prazo_encerrado"])

    carga2 = json.dumps([{
        "cotacao_item_id": item_futuro, "sku": "SKU-P1", "descricao": "Item",
        "quantidade": 10, "unidade": "un", "valor_unitario": 5, "disponivel": True,
    }]).replace("'", "''")
    res = j(f"select public.fn_responder_cotacao('{token_futuro}', 'Empresa', '{carga2}'::jsonb) as r")
    print("   resposta aceita:", res)

    # 3) sem prazo continua livre
    print("\n3) cotação sem prazo")
    cot_nulo, token_nulo, item_nulo = montar("null")
    pub3 = j(f"select public.fn_cotacao_publica('{token_nulo}') as r")
    print("   encerrado:", pub3["cotacao"]["prazo_encerrado"], "(null = sem prazo)")

finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK — nada permaneceu.")
