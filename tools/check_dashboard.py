"""Lê a tabela de resultados como o admin logado (mesmo caminho do navegador)."""

import json
import urllib.error
import urllib.request

BASE = "https://cowbpaaaguylhlvnlaac.supabase.co"
KEY = "sb_publishable_8IV6XloDeBJEn8UfAe5Tfg_nuGkZ7n5"
EMAIL = "00802998305@cotacao.app"
SENHA = "23071354"


def http(caminho, metodo="GET", corpo=None, token=None):
    headers = {"apikey": KEY, "Content-Type": "application/json"}
    headers["Authorization"] = f"Bearer {token or KEY}"
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(BASE + caminho, data=dados, headers=headers, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode() or "null")


status, sessao = http("/auth/v1/token?grant_type=password", "POST",
                      {"email": EMAIL, "password": SENHA})
if status != 200:
    raise SystemExit(f"login falhou: {status} {sessao}")
token = sessao["access_token"]

status, linhas = http(
    "/rest/v1/resultados_das_cotacoes?select=referencia,sku,quantidade,"
    "valor_aprovado,valor_maximo,economia_total,fornecedores(razao_social)"
    "&order=referencia.desc", token=token)
print("status:", status, "| linhas:", len(linhas) if isinstance(linhas, list) else linhas)

if isinstance(linhas, list) and linhas:
    por_mes = {}
    for l in linhas:
        mes = l["referencia"][:7]
        por_mes[mes] = por_mes.get(mes, 0) + float(l["economia_total"])
    print("economia por mês:", {k: round(v, 2) for k, v in por_mes.items()})
    print("total:", round(sum(por_mes.values()), 2))
    print("exemplo:", json.dumps(linhas[0], ensure_ascii=False))
