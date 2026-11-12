"""Run SQL against the Supabase Postgres instance.

Usage:
  python sql.py "select 1"          # inline SQL
  python sql.py -f script.sql       # from file
  echo "select 1" | python sql.py   # from stdin

Reads DSN from env SB_DSN (or DATABASE_URL). Prints JSON.
"""

import json
import sys

from pgclient import connect_from_dsn, PgError


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "-f":
        sql = open(args[1], encoding="utf-8").read()
    elif args:
        sql = " ".join(args)
    else:
        sql = sys.stdin.read()

    try:
        conn = connect_from_dsn()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"connect_error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        return 1

    try:
        info = {k: conn.params.get(k) for k in ("server_version", "server_encoding", "TimeZone")}
        result = conn.query(sql)
        out = {"server": info, **result}
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0
    except PgError as exc:
        print(json.dumps({"pg_error": str(exc), "sqlstate": exc.sqlstate,
                          "detail": exc.fields.get("D"), "hint": exc.fields.get("H")},
                         indent=2, ensure_ascii=False))
        return 2
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
