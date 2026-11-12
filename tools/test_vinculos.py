"""Testa a importação de vínculos e o envio por tabela (transação revertida)."""

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


def como(uid):
    c.query("reset role")
    c.query("set local role authenticated")
    c.query("set local request.jwt.claims = '%s'" % json.dumps({"sub": uid, "role": "authenticated"}))


try:
    c.query("begin")

    uid = um("""
        insert into auth.users (id, email, created_at, updated_at)
        values (gen_random_uuid(), 'admin.vinculos@cotacao.app', now(), now())
        returning id
    """)["id"]
    q(f"""
        insert into public.usuarios (auth_user_id, nome, cpf_cnpj, tipo, ativo)
        values ('{uid}', 'Admin', '11111111111', 'administrador', true)
    """)

    forns = q("""
        insert into public.fornecedores (razao_social, nome_fantasia, cnpj_cpf, ativo)
        values ('Alfa Suprimentos LTDA', 'Alfa', '11222333000181', true),
               ('Beta Ferramentas SA', 'Beta', '44555666000172', true)
        returning id, razao_social
    """)
    alfa, beta = forns[0]["id"], forns[1]["id"]

    print("1) importação de vínculos")
    linhas = [
        {"sku": "sku-001", "descricao": "Parafuso 8mm", "unidade": "un", "fornecedor": "Alfa Suprimentos LTDA"},
        {"sku": "sku-001", "descricao": "Parafuso 8mm", "unidade": "un", "fornecedor": "Beta Ferramentas SA"},
        {"sku": "SKU-002", "descricao": "Porca 8mm", "unidade": "un", "cnpj": "11.222.333/0001-81"},
        {"sku": "sku-003", "descricao": "Arruela 8mm", "unidade": "un", "fornecedor": "Fornecedor Inexistente"},
        {"sku": "", "descricao": "linha sem sku", "fornecedor": "Alfa Suprimentos LTDA"},
        {"sku": "sku-001", "descricao": "Parafuso 8mm", "unidade": "un", "fornecedor": "Alfa"},
    ]
    literal = json.dumps(linhas).replace("'", "''")
    como(uid)
    res = j(f"select public.fn_importar_produtos_por_fornecedor('{literal}'::jsonb) as r")
    print("  resultado:", res)

    vinculos = q("""
        select f.razao_social, p.sku
          from public.produto_por_fornecedor v
          join public.produtos p on p.id = v.produto_id
          join public.fornecedores f on f.id = v.fornecedor_id
         order by p.sku, f.razao_social
    """)
    print("  vínculos gravados:")
    for v in vinculos:
        print("   ", v["sku"], "->", v["razao_social"])

    print("\n2) envio por tabela (cotação com 3 itens, um sem fornecedor)")
    cot = um("""
        insert into public.cotacoes (titulo, criado_por)
        values ('Cotação vínculos', (select id from public.usuarios limit 1))
        returning id, codigo
    """)
    q(f"""
        insert into public.cotacao_itens (cotacao_id, sku, descricao, quantidade, unidade, ordem)
        values ('{cot['id']}', 'SKU-001', 'Parafuso 8mm', 100, 'un', 1),
               ('{cot['id']}', 'SKU-002', 'Porca 8mm', 200, 'un', 2),
               ('{cot['id']}', 'SKU-999', 'Item sem vínculo', 50, 'un', 3)
    """)

    cobertura = j(f"select public.fn_fornecedores_da_cotacao('{cot['id']}') as r")
    print("  total de itens:", cobertura["total_itens"])
    print("  itens sem fornecedor:", cobertura["itens_sem_fornecedor"])
    for f in cobertura["fornecedores"]:
        print(f"   {f['razao_social']:24} cobre {f['itens_cobertos']} item(ns)")

    print("\n3) leitura não pode chamar as funções")
    c.query("reset role")
    uid_leitura = um("""
        insert into auth.users (id, email, created_at, updated_at)
        values (gen_random_uuid(), 'leitura.vinculos@cotacao.app', now(), now())
        returning id
    """)["id"]
    q(f"""
        insert into public.usuarios (auth_user_id, nome, cpf_cnpj, tipo, ativo)
        values ('{uid_leitura}', 'Leitura', '22222222222', 'leitura', true)
    """)
    como(uid_leitura)
    for chamada in (f"select public.fn_fornecedores_da_cotacao('{cot['id']}')",
                    "select public.fn_importar_produtos_por_fornecedor('[]'::jsonb)"):
        c.query("savepoint s")
        try:
            q(chamada)
            print("   FALHA: deveria bloquear")
        except Exception as exc:
            print("   ok:", str(exc)[:70])
            c.query("rollback to savepoint s")
finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK — nada permaneceu.")
