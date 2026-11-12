"""Inventory helper: row counts, foreign keys, RLS policies, triggers."""

from pgclient import connect_from_dsn

c = connect_from_dsn()

print("== tabelas public: contagem exata / RLS ==")
tables = c.query("""
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p')
    order by 1
""")["rows"]
for t in tables:
    name = t["relname"]
    n = c.query('select count(*) as n from public."%s"' % name)["rows"][0]["n"]
    print("  %-22s rows=%-5s rls=%s" % (name, n, t["relrowsecurity"]))

print("\n== foreign keys ==")
for r in c.query("""
    select con.conname, src.relname as origem, tgt.relname as destino,
           pg_get_constraintdef(con.oid) as definicao
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class tgt on tgt.oid = con.confrelid
    join pg_namespace n on n.oid = src.relnamespace
    where con.contype = 'f' and n.nspname = 'public'
    order by 2, 1
""")["rows"]:
    print("  %-30s %s -> %s" % (r["conname"], r["origem"], r["destino"]))

print("\n== policies RLS ==")
pols = c.query("""
    select schemaname, tablename, policyname, cmd, roles::text as roles
    from pg_policies where schemaname in ('public')
    order by tablename, policyname
""")["rows"]
for r in pols:
    print("  %-20s %-28s %-8s roles=%s" % (r["tablename"], r["policyname"], r["cmd"], r["roles"]))
if not pols:
    print("  (nenhuma)")

print("\n== triggers public ==")
for r in c.query("""
    select tgrelid::regclass::text as tabela, tgname, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname = 'public'
    order by 1, 2
""")["rows"]:
    print("  %-22s %s" % (r["tabela"], r["tgname"]))

print("\n== extensoes ==")
for r in c.query("select extname, extversion from pg_extension order by 1")["rows"]:
    print("  %-22s %s" % (r["extname"], r["extversion"]))

c.close()
