"""Valida recebimento e nota fiscal no banco (transação revertida)."""

from pgclient import connect_from_dsn

c = connect_from_dsn()


def q(sql):
    return c.query(sql)["rows"]


try:
    c.query("begin")
    forn = q("""
        insert into public.fornecedores (razao_social, cnpj_cpf, email, whatsapp, contato_nome)
        values ('Fornecedor NF', '11222333000181', 'nf@x.com', '11988880001', 'Ana')
        returning id
    """)[0]["id"]

    ped = q(f"""
        insert into public.pedidos_gerados (fornecedor_id, valor_total)
        values ('{forn}', 1334.10)
        returning id, numero, status, recebido, nota_fiscal
    """)[0]
    print("pedido criado:", ped["numero"], "| recebido:", ped["recebido"],
          "| NF:", ped["nota_fiscal"], "| status:", ped["status"])

    q(f"""
        insert into public.pedido_itens
            (pedido_id, sku, descricao, quantidade, unidade, valor_de_custo_do_fornecedor)
        values ('{ped['id']}', 'SKU-1', 'Parafuso', 10, 'un', 12.50),
               ('{ped['id']}', 'SKU-2', 'Porca', 5, 'un', 8.00)
    """)

    q(f"""
        update public.pedidos_gerados
           set recebido = true, recebido_em = now(),
               nota_fiscal = '000123', nota_fiscal_em = now(), status = 'entregue'
         where id = '{ped['id']}'
    """)
    depois = q(f"""
        select recebido, recebido_em is not null as tem_data,
               nota_fiscal, nota_fiscal_em is not null as tem_data_nf, status
          from public.pedidos_gerados where id = '{ped['id']}'
    """)[0]
    print("após registrar:", depois)

    c.query("savepoint s")
    try:
        q(f"update public.pedidos_gerados set nota_fiscal = '   ' where id = '{ped['id']}'")
        print("FALHA: aceitou nota fiscal em branco")
    except Exception as exc:
        print("ok: nota fiscal em branco rejeitada ->", str(exc)[:70])
        c.query("rollback to savepoint s")

    total = q(f"""
        select valor_total, recebido, nota_fiscal from public.pedidos_gerados where id = '{ped['id']}'
    """)[0]
    print("total recalculado pelo trigger:", total)
finally:
    c.query("rollback")
    c.close()

print("\nROLLBACK — nada permaneceu.")
