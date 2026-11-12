"""Depura a listagem de cotações abertas por telefone."""

import json

from pgclient import connect_from_dsn

c = connect_from_dsn()


def q(sql):
    return c.query(sql)["rows"]


def um(sql):
    linhas = q(sql)
    return linhas[0] if linhas else None


chave = um("select chave from public.config_assistente where id = 1")["chave"]

try:
    c.query("begin")
    forn = um("""
        insert into public.fornecedores (razao_social, whatsapp)
        values ('Marina Carvalho', '85981647015') returning id, whatsapp
    """)
    cot = um("""
        insert into public.cotacoes (titulo, prazo_resposta)
        values ('Cotação WhatsApp', now() + interval '2 days')
        returning id, codigo, status
    """)
    q(f"""
        insert into public.cotacao_envios (cotacao_id, fornecedor_id, canal, enviado_em)
        values ('{cot['id']}', '{forn['id']}', 'whatsapp', now())
    """)

    print("fornecedor:", forn)
    print("cotacao:", cot)
    print("normalizado:", um(f"select public.fn_normaliza_telefone('{forn['whatsapp']}') as n"))

    print("\nenvios do fornecedor:")
    for e in q(f"select id, cotacao_id, status from public.cotacao_envios where fornecedor_id = '{forn['id']}'"):
        print("  ", e)

    print("\nsubquery isolada:")
    linhas = q(f"""
        select c.codigo, c.status, e.status as envio_status
          from public.cotacao_envios e
          join public.cotacoes c on c.id = e.cotacao_id
         where e.fornecedor_id = '{forn['id']}'
           and e.status <> 'respondido'
           and c.status not in ('aprovada', 'cancelada')
    """)
    print("  ", linhas)

    print("\nresultado da função:")
    r = json.loads(um(f"select public.fn_assistente_cotacao('{chave}', '85981647015') as r")["r"])
    print(json.dumps(r, ensure_ascii=False, indent=2)[:600])

finally:
    c.query("rollback")
    c.close()
