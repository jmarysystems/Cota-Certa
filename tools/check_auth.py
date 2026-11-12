"""Consulta as configuracoes de autenticacao que importam para o login por CPF."""

import json
import urllib.request

BASE = "https://cowbpaaaguylhlvnlaac.supabase.co"
KEY = "sb_publishable_8IV6XloDeBJEn8UfAe5Tfg_nuGkZ7n5"

req = urllib.request.Request(
    f"{BASE}/auth/v1/settings",
    headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"},
)
with urllib.request.urlopen(req, timeout=20) as resp:
    cfg = json.load(resp)

for chave in ("mailer_autoconfirm", "disable_signup", "external_email_enabled",
              "external_phone_enabled", "mailer_secure_email_change_enabled"):
    print(f"{chave:38} = {cfg.get(chave)}")

print("\nprovedores externos habilitados:",
      [k for k, v in (cfg.get("external") or {}).items() if v])
