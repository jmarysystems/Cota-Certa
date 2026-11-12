"""Teste ponta-a-ponta pela API (o mesmo caminho que o navegador usa).

Cria dois usuários de teste (admin e leitura) direto em auth.users, percorre
todo o fluxo pela REST/RPC com a chave publicável e no final apaga tudo.
"""

import json
import urllib.error
import urllib.request

from pgclient import connect_from_dsn

BASE = "https://cowbpaaaguylhlvnlaac.supabase.co"
KEY = "sb_publishable_8IV6XloDeBJEn8UfAe5Tfg_nuGkZ7n5"
SENHA = "Teste@12345"

c = connect_from_dsn()


def q(sql):
    return c.query(sql)["rows"]
criados = {"usuarios": [], "emails": []}


def http(caminho, metodo="GET", corpo=None, token=None, extra=None):
    headers = {"apikey": KEY, "Content-Type": "application/json"}
    headers["Authorization"] = f"Bearer {token or KEY}"
    if extra:
        headers.update(extra)
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(BASE + caminho, data=dados, headers=headers, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            texto = resp.read().decode()
            return resp.status, (json.loads(texto) if texto else None)
    except urllib.error.HTTPError as exc:
        texto = exc.read().decode()
        try:
            return exc.code, json.loads(texto)
        except json.JSONDecodeError:
            return exc.code, texto


def rest(tabela, metodo="GET", corpo=None, token=None, query=""):
    return http(f"/rest/v1/{tabela}{query}", metodo, corpo, token,
                {"Prefer": "return=representation"})


def rpc(nome, args, token=None):
    return http(f"/rest/v1/rpc/{nome}", "POST", args, token)


def criar_usuario(email, nome, cpf, tipo, fornecedor_id=None):
    criados["emails"].append(email)

    # Usa o próprio GoTrue para criar o usuário (schema correto) e depois
    # confirma o e-mail por SQL, já que o domínio @cotacao.local não recebe nada.
    status, corpo = http("/auth/v1/signup", "POST", {"email": email, "password": SENHA})
    if status not in (200, 201) or not isinstance(corpo, dict) or not corpo.get("id"):
        raise SystemExit(f"signup falhou para {email}: {status} {corpo}")
    uid = corpo["id"]

    q(f"update auth.users set email_confirmed_at = now(), updated_at = now() "
      f"where id = {sql_lit(uid)}")

    perfil = q("""
        insert into public.usuarios (auth_user_id, nome, cpf_cnpj, tipo, fornecedor_id, ativo)
        values (%s, %s, %s, %s, %s, true)
        returning id
    """ % (sql_lit(uid), sql_lit(nome), sql_lit(cpf), sql_lit(tipo),
           sql_lit(fornecedor_id) if fornecedor_id else "null"))[0]["id"]

    criados["usuarios"].append(perfil)
    criados["emails"].append(email)
    return uid, perfil


def sql_lit(valor):
    if valor is None:
        return "null"
    return "'" + str(valor).replace("'", "''") + "'"


def entrar(email):
    status, corpo = http("/auth/v1/token?grant_type=password", "POST",
                         {"email": email, "password": SENHA})
    if status != 200:
        raise SystemExit(f"login falhou para {email}: {status} {corpo}")
    return corpo["access_token"]


def passo(titulo):
    print("\n" + "=" * 70 + f"\n{titulo}\n" + "=" * 70)


try:
    passo("1. Criando usuários de teste (auth.users + usuarios)")
    _, perfil_admin = criar_usuario("11999990001@cotacao.local", "Admin Teste", "11999990001", "admin_sistema")
    _, perfil_leitura = criar_usuario("11999990002@cotacao.local", "Leitura Teste", "11999990002", "leitura")
    print("admin:", perfil_admin, "| leitura:", perfil_leitura)

    token_admin = entrar("11999990001@cotacao.local")
    token_leitura = entrar("11999990002@cotacao.local")
    print("login OK nos dois usuários")

    passo("2. Admin cadastra fornecedores")
    status, forns = rest("fornecedores", "POST", [
        {"razao_social": "Alfa Suprimentos LTDA", "nome_fantasia": "Alfa",
         "cnpj_cpf": "11222333000181", "contato_nome": "Ana", "email": "ana@alfa.com",
         "whatsapp": "11988880001", "cidade": "São Paulo", "estado": "SP",
         "prazo_entrega": "5 dias úteis", "tipo_pagamento": "boleto", "prazo_pagamento_dias": 30},
        {"razao_social": "Beta Ferramentas SA", "nome_fantasia": "Beta",
         "cnpj_cpf": "44555666000172", "contato_nome": "Bruno", "email": "bruno@beta.com",
         "whatsapp": "11988880002", "cidade": "Campinas", "estado": "SP",
         "prazo_entrega": "7 dias úteis", "tipo_pagamento": "pix", "prazo_pagamento_dias": 0},
    ], token_admin)
    assert status == 201, (status, forns)
    alfa, beta = forns[0]["id"], forns[1]["id"]
    print("fornecedores:", forns[0]["razao_social"], "|", forns[1]["razao_social"])

    passo("3. Admin importa uma lista (planilha) e sincroniza SKUs")
    status, _ = rest("lista_de_produtos", "POST", [
        {"lista": "Lista Teste API", "sku": "sku-001", "descricao": "Parafuso 8mm", "quantidade": 100, "unidade": "un", "ordem": 1},
        {"lista": "Lista Teste API", "sku": "SKU-002", "descricao": "Porca 8mm", "quantidade": 200, "unidade": "un", "ordem": 2},
        {"lista": "Lista Teste API", "sku": "sku-003", "descricao": "Arruela 8mm", "quantidade": 300, "unidade": "un", "ordem": 3},
    ], token_admin)
    assert status == 201, status
    status, res = rpc("importar_skus_da_lista", {"p_lista": "Lista Teste API"}, token_admin)
    print("importar_skus_da_lista:", status, res)
    assert status == 200 and res["inseridos"] == 3, res

    passo("4. Admin cria a cotação e importa os itens")
    status, cots = rest("cotacoes", "POST", [{
        "titulo": "Fixadores — obra 12",
        "observacao": "Entrega no CDM",
        "prazo_resposta": "2026-11-30",
        "criado_por": perfil_admin,
    }], token_admin)
    assert status == 201, (status, cots)
    cot = cots[0]
    print("cotação criada:", cot["codigo"], "| status:", cot["status"])

    status, res = rpc("fn_importar_lista_para_cotacao",
                      {"p_cotacao_id": cot["id"], "p_lista": "Lista Teste API"}, token_admin)
    print("fn_importar_lista_para_cotacao:", status, res)
    assert status == 200 and res["itens_importados"] == 3

    status, itens = rest("cotacao_itens", "GET", token=token_admin,
                         query=f"?cotacao_id=eq.{cot['id']}&order=ordem")
    print("itens:", [(i["sku"], i["descricao"]) for i in itens])

    passo("5. Admin finaliza e envia para os fornecedores")
    rest("cotacoes", "PATCH", {"status": "finalizada"}, token_admin, f"?id=eq.{cot['id']}")
    for fid, canal in ((alfa, "email"), (beta, "whatsapp")):
        status, ident = rpc("fn_registrar_envio", {
            "p_cotacao_id": cot["id"], "p_fornecedor_id": fid, "p_canal": canal,
            "p_status": "enviado",
        }, token_admin)
        print(f"  envio {canal}: {status}")

    status, envios = rest("cotacao_envios", "GET", token=token_admin,
                          query=f"?cotacao_id=eq.{cot['id']}")
    tokens = {e["fornecedor_id"]: e["token"] for e in envios}
    print("tokens gerados:", len(tokens))

    passo("6. Fornecedor responde pelo link (sem login, como anon)")
    for fid in (alfa, beta):
        status, pub = rpc("fn_cotacao_publica", {"p_token": tokens[fid]})
        assert status == 200, (status, pub)
        print(f"  {pub['fornecedor']['nome']}: {len(pub['itens'])} itens, já respondeu={pub['ja_respondido']}")

    precos = {
        alfa: [10.50, 8.00, 2.10],
        beta: [11.20, 6.40, 2.10],
    }
    for fid in (alfa, beta):
        lista = []
        for item, valor in zip(itens, precos[fid]):
            lista.append({
                "cotacao_item_id": item["id"], "sku": item["sku"],
                "descricao": item["descricao"], "quantidade": float(item["quantidade"]),
                "unidade": item["unidade"], "valor_unitario": valor, "disponivel": True,
            })
        status, res = rpc("fn_responder_cotacao", {
            "p_token": tokens[fid], "p_empresa": "Teste", "p_itens": lista,
            "p_prazo_entrega": "5 dias", "p_pagamento": "boleto", "p_validade": "30 dias",
            "p_observacao": None,
        })
        print(f"  resposta {fid[:4]}: {status} total={res.get('total') if isinstance(res, dict) else res}")
        assert status == 200, (status, res)

    # fornecedor não pode responder duas vezes
    status, res = rpc("fn_responder_cotacao",
                      {"p_token": tokens[alfa], "p_empresa": "X", "p_itens": []})
    print("  resposta duplicada:", status, res if isinstance(res, str) else res.get("message"))

    passo("7. Ranking e aprovação pelo menor custo")
    status, ranking = rest("vw_resultado_cotacao", "GET", token=token_admin,
                           query=f"?cotacao_id=eq.{cot['id']}&order=ordem,posicao")
    assert status == 200, (status, ranking)
    for r in ranking:
        print(f"  {r['sku']:8} {r['fornecedor']:20} R$ {r['valor_unitario']:>7} pos {r['posicao']}")

    status, res = rpc("fn_aprovar_cotacao", {"p_cotacao_id": cot["id"], "p_itens": None}, token_admin)
    print("  fn_aprovar_cotacao:", status, res)
    assert status == 200

    step_nome = "8. Geração dos pedidos"
    passo(step_nome)
    status, res = rpc("fn_gerar_pedidos", {"p_cotacao_id": cot["id"]}, token_admin)
    print("  fn_gerar_pedidos:", status, res)
    assert status == 200 and len(res["pedidos"]) == 2, res

    status, pedidos = rest("pedidos_gerados", "GET", token=token_admin,
                           query=f"?cotacao_id=eq.{cot['id']}&select=*,pedido_itens(*)")
    for p in pedidos:
        print(f"  {p['numero']} R$ {p['valor_total']} ({len(p['pedido_itens'])} itens) status={p['status']}")

    passo("9. Perfil Leitura não pode executar ação administrativa")
    status, res = rpc("fn_aprovar_cotacao", {"p_cotacao_id": cot["id"], "p_itens": None}, token_leitura)
    print("  fn_aprovar_cotacao como leitura:", status,
          res.get("message") if isinstance(res, dict) else res)
    assert status == 401, (status, res)

    status, res = rest("fornecedores", "POST", [{"razao_social": "Intruso"}], token_leitura)
    print("  insert em fornecedores como leitura:", status,
          res.get("message") if isinstance(res, dict) else res)
    assert status in (401, 403), (status, res)

    passo("10. Funil de envios por fornecedor")
    status, funil = rest("vw_cotacao_fornecedor_status", "GET", token=token_admin,
                         query=f"?cotacao_id=eq.{cot['id']}")
    for f in funil:
        print(f"  {f['fornecedor']:24} email={f['recebeu_email']} whatsapp={f['recebeu_whatsapp']} respondeu={f['respondeu']}")

    status, cot_final = rest("cotacoes", "GET", token=token_admin, query=f"?id=eq.{cot['id']}")
    print("\nstatus final da cotação:", cot_final[0]["status"])

finally:
    passo("LIMPEZA")
    q("""
        delete from public.pedido_itens;
        delete from public.pedidos_gerados;
        delete from public.cotacoes_aprovadas;
        delete from public.cotacao_respostas_itens;
        delete from public.cotacao_respostas;
        delete from public.cotacao_envios;
        delete from public.cotacao_itens;
        delete from public.cotacoes;
        delete from public.lista_de_produtos;
        delete from public.produto_por_fornecedor;
        delete from public.produtos;
        alter table public.usuarios disable trigger trg_protege_admin_sistema;
        delete from public.usuarios;
        alter table public.usuarios enable trigger trg_protege_admin_sistema;
        delete from public.fornecedores;
        delete from auth.identities
         where user_id in (select id from auth.users where email like '%%@cotacao.local');
        delete from auth.users where email like '%%@cotacao.local';
    """)
    q("alter sequence public.cotacao_codigo_seq restart with 1")
    q("alter sequence public.pedido_numero_seq restart with 1")

    resta = q("""
        select (select count(*) from public.cotacoes) as cotacoes,
               (select count(*) from public.usuarios) as usuarios,
               (select count(*) from auth.users where email like '%%@cotacao.local') as auth_users,
               (select count(*) from public.pedidos_gerados) as pedidos
    """)[0]
    print("estado após limpeza:", resta)
    c.close()
