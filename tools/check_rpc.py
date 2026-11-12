"""Valida os RPCs pela API REST exatamente como o navegador faria (chave publicável)."""

import json
import urllib.error
import urllib.request
import uuid

BASE = "https://cowbpaaaguylhlvnlaac.supabase.co"
KEY = "sb_publishable_8IV6XloDeBJEn8UfAe5Tfg_nuGkZ7n5"


def rpc(nome, args):
    req = urllib.request.Request(
        f"{BASE}/rest/v1/rpc/{nome}",
        data=json.dumps(args).encode(),
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode()[:400]
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:400]


token = str(uuid.uuid4())
for nome, args in [
    ("fn_cotacao_publica", {"p_token": token}),
    ("fn_responder_cotacao", {"p_token": token, "p_empresa": "Teste", "p_itens": []}),
    ("fn_aprovar_cotacao", {"p_cotacao_id": str(uuid.uuid4()), "p_itens": None}),
    ("fn_gerar_pedidos", {"p_cotacao_id": str(uuid.uuid4())}),
    ("importar_skus_da_lista", {"p_lista": "inexistente"}),
]:
    status, corpo = rpc(nome, args)
    print(f"{nome:28} -> {status} {corpo}")
