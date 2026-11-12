"""Checa se a chave publicável funciona no PostgREST e no Auth."""

import json
import urllib.error
import urllib.request

BASE = "https://cowbpaaaguylhlvnlaac.supabase.co"
KEY = "sb_publishable_8IV6XloDeBJEn8UfAe5Tfg_nuGkZ7n5"


def call(path, method="GET", body=None, extra=None):
    headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode()
            return resp.status, raw[:300]
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:300]
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


for path in ("/rest/v1/usuario?select=1", "/rest/v1/cotacoes?select=id&limit=1",
             "/auth/v1/settings"):
    status, body = call(path)
    print(f"{path} -> {status} {body}")
