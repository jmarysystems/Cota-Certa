"""Testa fn_confirmar_usuario: admin confirma, leitura e anon não."""

import json

from pgclient import connect_from_dsn

c = connect_from_dsn()


def q(sql):
    return c.query(sql)["rows"]


def como(uid):
    c.query("reset role")
    c.query("set local role authenticated")
    c.query("set local request.jwt.claims = '%s'" % json.dumps({"sub": uid, "role": "authenticated"}))


try:
    c.query("begin")

    alvo = q("""
        insert into auth.users (id, email, created_at, updated_at)
        values (gen_random_uuid(), 'teste.confirma@cotacao.app', now(), now())
        returning id, email_confirmed_at
    """)[0]
    print("usuário de teste:", alvo["id"], "| confirmado antes:", alvo["email_confirmed_at"])

    admin_uid = q("""
        insert into auth.users (id, email, created_at, updated_at)
        values (gen_random_uuid(), 'admin.confirma@cotacao.app', now(), now())
        returning id
    """)[0]["id"]
    leitura_uid = q("""
        insert into auth.users (id, email, created_at, updated_at)
        values (gen_random_uuid(), 'leitura.confirma@cotacao.app', now(), now())
        returning id
    """)[0]["id"]
    q(f"""
        insert into public.usuarios (auth_user_id, nome, cpf_cnpj, tipo, ativo)
        values ('{admin_uid}', 'Admin', '11111111111', 'administrador', true),
               ('{leitura_uid}', 'Leitura', '22222222222', 'leitura', true)
    """)

    print("\n1) admin confirma")
    como(admin_uid)
    res = q(f"select public.fn_confirmar_usuario('{alvo['id']}') as r")[0]["r"]
    print("   retorno:", res)

    c.query("reset role")
    estado = q(f"select email_confirmed_at from auth.users where id = '{alvo['id']}'")[0]
    print("   confirmado depois:", bool(estado["email_confirmed_at"]))

    print("\n2) leitura tenta confirmar")
    como(leitura_uid)
    c.query("savepoint s1")
    try:
        q(f"select public.fn_confirmar_usuario('{alvo['id']}')")
        print("   FALHA: deveria ter bloqueado")
    except Exception as exc:
        print("   ok:", str(exc)[:80])
        c.query("rollback to savepoint s1")

    print("\n3) anon tenta confirmar")
    c.query("reset role")
    c.query("set local role anon")
    c.query("set local request.jwt.claims = '{}'")
    c.query("savepoint s2")
    try:
        q(f"select public.fn_confirmar_usuario('{alvo['id']}')")
        print("   FALHA: deveria ter bloqueado")
    except Exception as exc:
        print("   ok:", str(exc)[:80])
        c.query("rollback to savepoint s2")

finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK — nada permaneceu.")
