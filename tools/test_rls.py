"""Valida RLS e guardas de perfil simulando o JWT dentro de uma transação.

Não usa HTTP: troca de papel (SET ROLE) e claims (request.jwt.claims), que é
exatamente o que o PostgREST faz a cada requisição. Tudo termina em ROLLBACK.
"""

import json

from pgclient import connect_from_dsn

c = connect_from_dsn()


def q(sql):
    return c.query(sql)["rows"]


def um(sql):
    linhas = q(sql)
    return linhas[0] if linhas else None


def j(sql):
    """Executa uma função que devolve jsonb e desserializa o resultado."""
    return json.loads(um(sql)["r"])


def como(uid, papel="authenticated"):
    c.query("reset role")
    c.query(f"set local role {papel}")
    claims = json.dumps({"sub": uid, "role": papel})
    c.query(f"set local request.jwt.claims = '{claims}'")


def como_postgres():
    c.query("reset role")
    c.query("set local request.jwt.claims = '{}'")


def espera_erro(sql, rotulo):
    c.query("savepoint sp")
    try:
        c.query(sql)
        print(f"   FALHA: {rotulo} deveria ter sido bloqueado")
        c.query("rollback to savepoint sp")
        return False
    except Exception as exc:
        print(f"   ok: {rotulo} -> {str(exc)[:80]}")
        c.query("rollback to savepoint sp")
        return True


esperados = []
try:
    c.query("begin")

    # ---------------- prepara usuários (como postgres) ----------------
    uids = {}
    for chave, doc, tipo in (("admin", "11999990001", "administrador"),
                             ("leitura", "11999990002", "leitura"),
                             ("forn", "11999990003", "fornecedor")):
        uid = um(f"""
            insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
            values (gen_random_uuid(), '{doc}@cotacao.app', now(), now(), now())
            returning id
        """)["id"]
        uids[chave] = uid

    forns = q("""
        insert into public.fornecedores (razao_social, cnpj_cpf, email, whatsapp, contato_nome)
        values ('Alfa RLS', '11222333000181', 'alfa@x.com', '11988880001', 'Ana'),
               ('Beta RLS', '44555666000172', 'beta@x.com', '11988880002', 'Bruno')
        returning id, razao_social
    """)
    alfa, beta = forns[0]["id"], forns[1]["id"]

    q(f"""
        insert into public.usuarios (auth_user_id, nome, cpf_cnpj, tipo, fornecedor_id, ativo)
        values
          ('{uids['admin']}', 'Admin RLS', '11999990001', 'administrador', null, true),
          ('{uids['leitura']}', 'Leitura RLS', '11999990002', 'leitura', null, true),
          ('{uids['forn']}', 'Fornecedor RLS', '11999990003', 'fornecedor', '{alfa}', true)
    """)

    q("""
        insert into public.lista_de_produtos (lista, sku, descricao, quantidade, unidade, ordem)
        values ('Lista RLS', 'sku-001', 'Parafuso', 100, 'un', 1),
               ('Lista RLS', 'sku-002', 'Porca', 200, 'un', 2),
               ('Lista RLS', 'sku-003', 'Arruela', 300, 'un', 3)
    """)

    # ---------------- ADMIN ----------------
    print("1) Como ADMINISTRADOR")
    como(uids["admin"])
    print("   tipo_usuario() =", um("select public.tipo_usuario() as t")["t"])

    lista = j("select public.importar_skus_da_lista('Lista RLS') as r")
    print("   importar_skus_da_lista:", lista)

    cot = um("""
        insert into public.cotacoes (titulo, prazo_resposta, criado_por)
        values ('Cotação RLS', current_date + 5,
                (select id from public.usuarios where auth_user_id = auth.uid()))
        returning id, codigo
    """)
    print("   cotação:", cot["codigo"])

    imp = j(f"select public.fn_importar_lista_para_cotacao('{cot['id']}', 'Lista RLS') as r")
    print("   itens importados:", imp["itens_importados"])

    for fid, canal in ((alfa, "email"), (beta, "whatsapp")):
        c.query(f"select public.fn_registrar_envio('{cot['id']}', '{fid}', '{canal}')")

    tokens = {r["fornecedor_id"]: r["token"] for r in
              q(f"select fornecedor_id, token from public.cotacao_envios where cotacao_id = '{cot['id']}'")}
    print("   envios/tokens:", len(tokens))

    print("   cotacoes visíveis:", um("select count(*) as n from public.cotacoes")["n"])
    print("   fornecedores visíveis:", um("select count(*) as n from public.fornecedores")["n"])

    # ---------------- ANON (link público) ----------------
    print("\n2) Como ANON (link do fornecedor)")
    itens = q(f"select id, sku, descricao, quantidade, unidade from public.cotacao_itens where cotacao_id = '{cot['id']}' order by ordem")
    try:
        c.query("reset role")
        c.query("set local role anon")
        c.query("set local request.jwt.claims = '{}'")
        pub = json.loads(um(f"select public.fn_cotacao_publica('{tokens[alfa]}') as r")["r"])
        print("   fn_cotacao_publica:", pub["cotacao"]["codigo"], "|", len(pub["itens"]), "itens")

        for fid, precos in ((alfa, [10.5, 8.0, 2.1]), (beta, [11.2, 6.4, 2.1])):
            carga = []
            for item, valor in zip(itens, precos):
                carga.append({
                    "cotacao_item_id": item["id"], "sku": item["sku"],
                    "descricao": item["descricao"], "quantidade": float(item["quantidade"]),
                    "unidade": item["unidade"], "valor_unitario": valor, "disponivel": True,
                })
            literal = json.dumps(carga).replace("'", "''")
            res = j(f"select public.fn_responder_cotacao('{tokens[fid]}', 'Empresa', '{literal}'::jsonb) as r")
            print(f"   resposta {fid[:4]}:", res)

        espera_erro(f"select 1 from public.cotacoes", "anon ler tabela cotacoes")
        espera_erro(f"select public.fn_aprovar_cotacao('{cot['id']}', null)", "anon aprovar cotação")
    except Exception as exc:
        print("   (não foi possível assumir o papel anon:", str(exc)[:90], ")")

    # ---------------- ADMIN aprova ----------------
    print("\n3) ADMIN aprova e gera pedidos")
    como(uids["admin"])
    rank = q(f"select sku, fornecedor, valor_unitario, posicao from public.vw_resultado_cotacao where cotacao_id = '{cot['id']}' order by ordem, posicao")
    for r in rank:
        print(f"   {r['sku']:8} {r['fornecedor']:12} R$ {r['valor_unitario']:>6} pos {r['posicao']}")

    apr = j(f"select public.fn_aprovar_cotacao('{cot['id']}') as r")
    print("   aprovacao:", apr)
    ped = j(f"select public.fn_gerar_pedidos('{cot['id']}') as r")
    print("   pedidos:", [p["numero"] for p in ped["pedidos"]])

    # ---------------- LEITURA ----------------
    print("\n4) Como LEITURA (só consulta)")
    como(uids["leitura"])
    print("   tipo_usuario() =", um("select public.tipo_usuario() as t")["t"])
    print("   cotacoes visíveis:", um("select count(*) as n from public.cotacoes")["n"])
    print("   pedidos visíveis:", um("select count(*) as n from public.pedidos_gerados")["n"])
    espera_erro("insert into public.fornecedores (razao_social) values ('Intruso')",
                "leitura cadastrar fornecedor")
    espera_erro(f"select public.fn_aprovar_cotacao('{cot['id']}', null)", "leitura aprovar cotação")
    espera_erro(f"select public.fn_gerar_pedidos('{cot['id']}')", "leitura gerar pedido")

    # ---------------- FORNECEDOR ----------------
    print("\n5) Como FORNECEDOR (só o que é dele)")
    como(uids["forn"])
    print("   tipo_usuario() =", um("select public.tipo_usuario() as t")["t"])
    print("   cotacoes visíveis:", um("select count(*) as n from public.cotacoes")["n"])
    print("   envios visíveis:", um("select count(*) as n from public.cotacao_envios")["n"])
    print("   respostas visíveis:", um("select count(*) as n from public.vw_resultado_cotacao")["n"])
    print("   fornecedores visíveis para ele:", um("select count(*) as n from public.fornecedores")["n"], "(só o próprio)")
    espera_erro("insert into public.produtos (sku, descricao, unidade) values ('X','X','un')",
                "fornecedor cadastrar produto")

    # ---------------- ADMIN DO SISTEMA ----------------
    print("\n6) Administrador do Sistema é único e protegido")
    como_postgres()
    q("""
        update public.usuarios set tipo = 'admin_sistema'
         where auth_user_id = (select auth_user_id from public.usuarios where nome = 'Leitura RLS')
    """)
    espera_erro("""
        update public.usuarios set tipo = 'admin_sistema'
         where auth_user_id = (select auth_user_id from public.usuarios where nome = 'Admin RLS')
    """, "segundo Administrador do Sistema")
    espera_erro("""
        delete from public.usuarios where tipo = 'admin_sistema'
    """, "excluir Administrador do Sistema")
    espera_erro("""
        update public.usuarios set tipo = 'administrador' where tipo = 'admin_sistema'
    """, "rebaixar Administrador do Sistema")

finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK executado — nenhum dado permaneceu.")
