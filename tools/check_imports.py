"""Confere imports nomeados e acessos via namespace (ui.*, api.*)."""

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQUIVOS = [
    RAIZ / "assets" / "app.js",
    RAIZ / "assets" / "resposta.js",
    RAIZ / "assets" / "views" / "cotacoes.js",
    RAIZ / "assets" / "views" / "cadastros.js",
    RAIZ / "assets" / "views" / "usuarios.js",
    RAIZ / "assets" / "views" / "pedidos.js",
]

re_nomeado = re.compile(r"import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]", re.S)
re_namespace = re.compile(r"import\s+\*\s+as\s+(\w+)\s+from\s*['\"]([^'\"]+)['\"]")

cache: dict[Path, set[str]] = {}


def exportados(caminho: Path) -> set[str]:
    if caminho in cache:
        return cache[caminho]
    texto = caminho.read_text(encoding="utf-8")
    nomes = set(re.findall(r"export\s+(?:async\s+)?function\s+(\w+)", texto))
    nomes |= set(re.findall(r"export\s+(?:const|let|var)\s+(\w+)", texto))
    nomes |= set(re.findall(r"export\s+class\s+(\w+)", texto))
    cache[caminho] = nomes
    return nomes


problemas = 0

for arquivo in ARQUIVOS:
    texto = arquivo.read_text(encoding="utf-8")

    for nomes, alvo in re_nomeado.findall(texto):
        destino = (arquivo.parent / alvo).resolve()
        if not destino.exists():
            print(f"ERRO {arquivo.name}: módulo inexistente -> {alvo}")
            problemas += 1
            continue
        disponiveis = exportados(destino)
        for nome in [n.strip() for n in nomes.split(",") if n.strip()]:
            if nome not in disponiveis:
                print(f"ERRO {arquivo.name}: '{nome}' não é exportado por {alvo}")
                problemas += 1

    for alias, alvo in re_namespace.findall(texto):
        destino = (arquivo.parent / alvo).resolve()
        if not destino.exists():
            print(f"ERRO {arquivo.name}: módulo inexistente -> {alvo}")
            problemas += 1
            continue
        disponiveis = exportados(destino)
        # remove literais de texto para não confundir "import ... from './ui.js'"
        sem_strings = re.sub(r"['\"][^'\"]*['\"]", "''", texto)
        usados = set(re.findall(rf"\b{alias}\.(\w+)", sem_strings))
        for nome in sorted(usados):
            if nome not in disponiveis:
                print(f"ERRO {arquivo.name}: {alias}.{nome} não existe em {alvo}")
                problemas += 1
        print(f"ok   {arquivo.name}: {len(usados)} acessos a {alias} verificados")

print("\napi.js exporta:", ", ".join(sorted(exportados((RAIZ / 'assets' / 'api.js').resolve()))))
print("ui.js exporta :", ", ".join(sorted(exportados((RAIZ / 'assets' / 'ui.js').resolve()))))
print("\nproblemas:", problemas)
