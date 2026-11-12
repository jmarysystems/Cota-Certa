"""Alinha o e-mail de login do admin com o CPF e valida a entrada de verdade."""

import json
import urllib.error
import urllib.request

from pgclient import connect_from_dsn

BASE = "https://cowbpaaaguylhlvnlaac.supabase.co"
KEY = "sb_publishable_8IV6XloDeBJEn8UfAe5Tfg_nuGkZ7n5"
CPF = "00802998305"
NOVO_EMAIL = f"{CPF}@cotacao.app"
SENHA = "23071354"

c = connect_from_dsn()

uid = c.query(f"select auth_user_id from public.usuarios where cpf_cnpj = '{CPF}'")["rows"][0]["auth_user_id"]
print("auth_user_id:", uid)

antes = c.query(f"select email from auth.users where id = '{uid}'")["rows"][0]["email"]
print("e-mail atual:", antes)

c.query(f"update auth.users set email = '{NOVO_EMAIL}', updated_at = now() where id = '{uid}'")
c.query(f"""
    update auth.identities
       set provider_id = '{NOVO_EMAIL}',
           identity_data = jsonb_set(coalesce(identity_data, '{{}}'::jsonb),
                                     '{{email}}', '"{NOVO_EMAIL}"'),
           updated_at = now()
     where user_id = '{uid}'
""")
depois = c.query(f"select email, email_confirmed_at from auth.users where id = '{uid}'")["rows"][0]
print("e-mail agora:", depois["email"], "| confirmado:", bool(depois["email_confirmed_at"]))


def login(email, senha):
    req = urllib.request.Request(
        f"{BASE}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": senha}).encode(),
        headers={"apikey": KEY, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode() or "{}")


status, corpo = login(NOVO_EMAIL, SENHA)
print("\nlogin com a senha informada:", status,
      corpo.get("error_description") or corpo.get("msg") or "OK")

if status != 200:
    print("senha não confere -> redefinindo para a informada (bcrypt cost 10)")
    c.query(f"""
        update auth.users
           set encrypted_password = extensions.crypt('{SENHA}', extensions.gen_salt('bf', 10)),
               updated_at = now()
         where id = '{uid}'
    """)
    status, corpo = login(NOVO_EMAIL, SENHA)
    print("login após redefinir:", status,
          corpo.get("error_description") or corpo.get("msg") or "OK")

if status == 200:
    token = corpo["access_token"]
    print("token obtido | expires_in:", corpo.get("expires_in"))

    req = urllib.request.Request(
        f"{BASE}/rest/v1/usuarios?select=id,nome,cpf_cnpj,tipo,ativo",
        headers={"apikey": KEY, "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        perfil = json.load(resp)
    print("perfil lido com RLS:", json.dumps(perfil, ensure_ascii=False))

    req = urllib.request.Request(
        f"{BASE}/rest/v1/rpc/tipo_usuario",
        data=b"{}",
        headers={"apikey": KEY, "Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        print("tipo_usuario():", resp.read().decode())

c.close()
