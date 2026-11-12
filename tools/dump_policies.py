"""Dump existing RLS policies with full definitions, plus constraints and grants."""

from pgclient import connect_from_dsn

c = connect_from_dsn()

print("== POLICIES (definicao completa) ==")
rows = c.query("""
    select tablename, policyname, cmd, roles::text as roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, cmd, policyname
""")["rows"]
for r in rows:
    print("\n[%s] %s (%s) roles=%s" % (r["tablename"], r["policyname"], r["cmd"], r["roles"]))
    if r["qual"]:
        print("   using: %s" % " ".join(r["qual"].split()))
    if r["with_check"]:
        print("   check: %s" % " ".join(r["with_check"].split()))

print("\n== CONSTRAINTS ==")
for r in c.query("""
    select c.relname as tabela, con.conname, con.contype, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and con.contype in ('c','u','p')
    order by 1, 2
""")["rows"]:
    print("  %-22s %-42s %s" % (r["tabela"], r["conname"], " ".join(r["def"].split())))

print("\n== GRANTS em public ==")
for r in c.query("""
    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
    group by 1,2 order by 1,2
""")["rows"]:
    print("  %-24s %-14s %s" % (r["table_name"], r["grantee"], r["privs"]))

print("\n== DEFAULT PRIVILEGES ==")
for r in c.query("""
    select pg_get_userbyid(defaclrole) as owner, defaclobjtype, defaclacl::text
    from pg_default_acl
""")["rows"]:
    print("  %s %s %s" % (r["owner"], r["defaclobjtype"], r["defaclacl"]))

c.close()
