"""Teste ponta-a-ponta do fluxo de cotação, dentro de BEGIN ... ROLLBACK.

Cobre: importação de SKU -> criação de cotação -> envio -> resposta por token ->
ranking por menor custo -> aprovação -> geração de pedidos.
Nada é persistido: a transação termina em ROLLBACK.
"""

import json

from pgclient import connect_from_dsn

c = connect_from_dsn()


def q(sql, **kw):
    return c.query(sql)["rows"]


def one(sql):
    rows = q(sql)
    return rows[0] if rows else None


def j(sql):
    """Executa SQL que devolve jsonb e desserializa."""
    return json.loads(one(sql)["r"])


try:
    c.query("begin")

    forn = q("""
        insert into public.fornecedores
            (razao_social, nome_fantasia, cnpj_cpf, contato_nome, email, whatsapp,
             prazo_entrega, tipo_pagamento, prazo_pagamento_dias)
        values
            ('Fornecedor Alfa LTDA', 'Alfa', '11222333000181', 'Ana', 'alfa@teste.com',
             '5511999990001', '5 dias úteis', 'boleto', 30),
            ('Fornecedor Beta SA', 'Beta', '44555666000172', 'Bruno', 'beta@teste.com',
             '5511999990002', '7 dias úteis', 'pix', 0)
        returning id, razao_social
    """)
    alfa, beta = forn[0]["id"], forn[1]["id"]

    # lista de produtos (simula planilha importada)
    q("""
        insert into public.lista_de_produtos (lista, sku, descricao, quantidade, unidade, ordem)
        values
            ('Lista Teste', 'sku-001', 'Parafuso sextavado 8mm', 100, 'un', 1),
            ('Lista Teste', 'SKU-002', 'Porca sextavada 8mm', 200, 'un', 2),
            ('Lista Teste', 'sku-003', 'Arruela lisa 8mm', 300, 'un', 3)
    """)

    imp = j("select public.importar_skus_da_lista('Lista Teste') as r")
    print("1) importar_skus_da_lista:", json.dumps(imp, ensure_ascii=False))

    cot = one("""
        insert into public.cotacoes (titulo, observacao, prazo_resposta)
        values ('Cotação de fixadores', 'Entrega no CD', current_date + 7)
        returning id, codigo, status
    """)
    print("2) cotação criada:", cot["codigo"], "status =", cot["status"])

    imp2 = j("select public.fn_importar_lista_para_cotacao('%s', 'Lista Teste') as r" % cot["id"])
    print("3) fn_importar_lista_para_cotacao:", json.dumps(imp2, ensure_ascii=False))

    itens = q("select id, sku, descricao, quantidade, unidade from public.cotacao_itens where cotacao_id = '%s' order by ordem" % cot["id"])
    for it in itens:
        print("   item:", it["sku"], it["descricao"], it["quantidade"], it["unidade"])

    # envio para os dois fornecedores
    for fid, canal in ((alfa, "email"), (beta, "whatsapp")):
        q("select public.fn_registrar_envio('%s', '%s', '%s')" % (cot["id"], fid, canal))

    envios = q("select fornecedor_id, canal, token, status from public.cotacao_envios where cotacao_id = '%s'" % cot["id"])
    tokens = {e["fornecedor_id"]: (e["token"], e["canal"]) for e in envios}
    print("4) envios registrados:", [(t[1], t[0][:8] + "...") for t in tokens.values()])

    pub = j("select public.fn_cotacao_publica('%s') as r" % tokens[alfa][0])
    print("5) fn_cotacao_publica: cotacao=%s itens=%d ja_respondido=%s"
          % (pub["cotacao"]["codigo"], len(pub["itens"]), pub["ja_respondido"]))

    # Alfa mais barato nos itens 1 e 3; Beta mais barato no item 2
    precos = {
        alfa: [("10.50", True), ("8.00", True), ("2.10", True)],
        beta: [("11.20", True), ("6.40", True), ("2.10", True)],
    }
    for fid, token in ((alfa, tokens[alfa][0]), (beta, tokens[beta][0])):
        arr = []
        for it, (valor, disp) in zip(itens, precos[fid]):
            arr.append({
                "cotacao_item_id": it["id"], "sku": it["sku"], "descricao": it["descricao"],
                "quantidade": float(it["quantidade"]), "unidade": it["unidade"],
                "valor_unitario": float(valor), "disponivel": disp,
            })
        payload = json.dumps(arr).replace("'", "''")
        res = j("""
            select public.fn_responder_cotacao('%s', 'Empresa %s', '%s'::jsonb,
                    '5 dias', 'boleto', '30 dias', 'ok') as r
        """ % (token, fid[:4], payload))
        print("6) resposta de %s: total = %s (%s itens)" % (fid[:4], res["total"], res["itens"]))

    # segunda resposta deve ser bloqueada (savepoint para não abortar a transação)
    c.query("savepoint dup")
    try:
        q("select public.fn_responder_cotacao('%s', 'X', '[]'::jsonb)" % tokens[alfa][0])
        print("7) ERRO: deveria ter bloqueado resposta duplicada")
    except Exception as exc:
        print("7) resposta duplicada bloqueada:", str(exc)[:70])
    finally:
        c.query("rollback to savepoint dup")

    rank = q("""
        select sku, fornecedor, valor_unitario, posicao
        from public.vw_resultado_cotacao
        where cotacao_id = '%s' order by ordem, posicao
    """ % cot["id"])
    print("8) ranking:")
    for r in rank:
        print("   %-8s %-18s R$ %-8s pos %s" % (r["sku"], r["fornecedor"], r["valor_unitario"], r["posicao"]))

    apr = j("select public.fn_aprovar_cotacao('%s') as r" % cot["id"])
    print("9) fn_aprovar_cotacao:", json.dumps(apr, ensure_ascii=False))

    aprov = q("""
        select sku, fornecedor_id, valor_de_custo_do_fornecedor, valor_total
        from public.cotacoes_aprovadas where cotacao_id = '%s' order by sku
    """ % cot["id"])
    for a in aprov:
        quem = "Alfa" if a["fornecedor_id"] == alfa else "Beta"
        print("   aprovado: %-8s %-5s R$ %-7s total R$ %s"
              % (a["sku"], quem, a["valor_de_custo_do_fornecedor"], a["valor_total"]))

    ped = j("select public.fn_gerar_pedidos('%s') as r" % cot["id"])
    print("10) fn_gerar_pedidos:", json.dumps(ped, ensure_ascii=False))

    for p in q("select numero, valor_total, data_pedido, status from public.pedidos_gerados order by numero"):
        print("    pedido %s | R$ %s | %s | %s" % (p["numero"], p["valor_total"], p["data_pedido"], p["status"]))

    for p in q("""
        select pg.numero, pi.sku, pi.descricao, pi.quantidade, pi.unidade,
               pi.valor_de_custo_do_fornecedor, pi.valor_total
        from public.pedido_itens pi join public.pedidos_gerados pg on pg.id = pi.pedido_id
        order by pg.numero, pi.sku
    """):
        print("    item %s %-8s %-30s %s %s x R$ %s = R$ %s"
              % (p["numero"], p["sku"], p["descricao"], p["quantidade"], p["unidade"],
                 p["valor_de_custo_do_fornecedor"], p["valor_total"]))

    st = q("""
        select fornecedor, recebeu_email, recebeu_whatsapp, respondeu, respostas
        from public.vw_cotacao_fornecedor_status where cotacao_id = '%s' order by fornecedor
    """ % cot["id"])
    print("11) funil:")
    for s in st:
        print("   %-22s email=%s whatsapp=%s respondeu=%s respostas=%s"
              % (s["fornecedor"], s["recebeu_email"], s["recebeu_whatsapp"], s["respondeu"], s["respostas"]))

    cot_final = one("select status from public.cotacoes where id = '%s'" % cot["id"])
    print("12) status final da cotação:", cot_final["status"])

finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK executado — banco intacto.")
