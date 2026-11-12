"""Minimal pure-stdlib PostgreSQL client (protocol v3).

Supports: TLS (sslmode=require/prefer/disable), SCRAM-SHA-256 and cleartext/md5
auth fallbacks, simple query protocol, text results.

No third-party dependencies: socket, ssl, hashlib, hmac, base64, struct.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import socket
import ssl
import struct
from urllib.parse import unquote, urlparse

PROTOCOL_VERSION = 196608  # 3.0


class PgError(Exception):
    def __init__(self, fields: dict[str, str]):
        self.fields = fields
        self.sqlstate = fields.get("C", "")
        self.message = fields.get("M", "unknown error")
        super().__init__(f"{self.sqlstate}: {self.message}")


def _cstring(s: str) -> bytes:
    return s.encode("utf-8") + b"\x00"


def _read_exact(sock, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed by server")
        buf += chunk
    return bytes(buf)


class PG:
    def __init__(self, host, port=5432, user="postgres", password="", dbname="postgres",
                 sslmode="require", timeout=20):
        self.host = host
        self.port = int(port)
        self.user = user
        self.password = password
        self.dbname = dbname
        self.sslmode = sslmode
        self.timeout = timeout
        self.sock = None
        self.params: dict[str, str] = {}
        self._connect()

    # ---------------- connection ----------------
    def _connect(self):
        raw = socket.create_connection((self.host, self.port), timeout=self.timeout)
        raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sock = raw

        if self.sslmode in ("require", "prefer", "verify-ca", "verify-full"):
            sock.sendall(struct.pack("!ii", 8, 80877103))
            answer = _read_exact(sock, 1)
            if answer == b"S":
                ctx = ssl.create_default_context()
                if self.sslmode in ("require", "prefer"):
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                sock = ctx.wrap_socket(raw, server_hostname=self.host)
            elif self.sslmode in ("require", "verify-ca", "verify-full"):
                raise ConnectionError("server refused TLS but sslmode requires it")

        self.sock = sock
        self._startup()
        self._authenticate()
        self._wait_ready()

    def _startup(self):
        body = struct.pack("!i", PROTOCOL_VERSION)
        params = {
            "user": self.user,
            "database": self.dbname,
            "client_encoding": "UTF8",
            "application_name": "dsh-pgclient",
        }
        for k, v in params.items():
            body += _cstring(k) + _cstring(v)
        body += b"\x00"
        self.sock.sendall(struct.pack("!i", len(body) + 4) + body)

    def _recv_message(self):
        header = _read_exact(self.sock, 5)
        mtype = header[:1]
        (length,) = struct.unpack("!i", header[1:5])
        payload = _read_exact(self.sock, length - 4) if length > 4 else b""
        return mtype, payload

    def _auth_ok_wait(self, payload):
        raise NotImplementedError

    def _authenticate(self):
        scram = None
        while True:
            mtype, payload = self._recv_message()
            if mtype == b"E":
                raise PgError(_parse_error(payload))
            if mtype == b"N":
                continue
            if mtype != b"R":
                raise ConnectionError(f"unexpected message during auth: {mtype!r}")
            (code,) = struct.unpack("!i", payload[:4])
            data = payload[4:]

            if code == 0:  # AuthenticationOk
                return
            if code == 3:  # cleartext
                self._send_password(self.password)
            elif code == 5:  # md5
                salt = data[:4]
                inner = hashlib.md5((self.password + self.user).encode()).hexdigest()
                outer = hashlib.md5(inner.encode() + salt).hexdigest()
                self._send_password("md5" + outer)
            elif code == 10:  # SASL
                mechanisms = [m.decode() for m in data.split(b"\x00") if m]
                if "SCRAM-SHA-256" not in mechanisms:
                    raise ConnectionError(f"no supported SASL mechanism in {mechanisms}")
                scram = ScramSha256(self.password)
                first = scram.client_first()
                body = _cstring("SCRAM-SHA-256") + struct.pack("!i", len(first)) + first
                self.sock.sendall(b"p" + struct.pack("!i", len(body) + 4) + body)
            elif code == 11:  # SASL continue
                final = scram.client_final(data)
                self.sock.sendall(b"p" + struct.pack("!i", len(final) + 4) + final)
            elif code == 12:  # SASL final
                scram.verify_server(data)
            else:
                raise ConnectionError(f"unsupported auth method code {code}")

    def _send_password(self, password: str):
        body = _cstring(password)
        self.sock.sendall(b"p" + struct.pack("!i", len(body) + 4) + body)

    def _wait_ready(self):
        while True:
            mtype, payload = self._recv_message()
            if mtype == b"E":
                raise PgError(_parse_error(payload))
            if mtype == b"S":  # ParameterStatus
                key, val = payload.split(b"\x00")[:2]
                self.params[key.decode()] = val.decode()
            elif mtype == b"Z":  # ReadyForQuery
                return

    # ---------------- queries ----------------
    def query(self, sql: str):
        """Run SQL via the simple query protocol.

        Returns dict with: columns, rows (list of dicts), tag, errors.
        """
        body = _cstring(sql)
        self.sock.sendall(b"Q" + struct.pack("!i", len(body) + 4) + body)

        columns: list[str] = []
        rows: list[dict] = []
        tag = ""
        last_error = None

        while True:
            mtype, payload = self._recv_message()
            if mtype == b"T":  # RowDescription
                columns = _parse_row_description(payload)
                rows = []
            elif mtype == b"D":  # DataRow
                rows.append(_parse_data_row(payload, columns))
            elif mtype == b"C":  # CommandComplete
                tag = payload.split(b"\x00")[0].decode()
            elif mtype == b"I":  # EmptyQueryResponse
                tag = ""
            elif mtype == b"E":
                last_error = PgError(_parse_error(payload))
            elif mtype == b"N":  # NoticeResponse
                pass
            elif mtype == b"Z":  # ReadyForQuery
                break
            elif mtype in (b"1", b"2", b"3", b"n", b"s", b"A"):
                pass  # parse/bind/close/describe/portal/notification: unused
            else:
                pass

        if last_error is not None:
            raise last_error
        return {"columns": columns, "rows": rows, "tag": tag}

    def close(self):
        try:
            self.sock.sendall(b"X" + struct.pack("!i", 4))
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass

    # ---------------- helpers ----------------
    @property
    def server(self):
        return self.params

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _parse_error(payload: bytes) -> dict[str, str]:
    fields = {}
    for part in payload.split(b"\x00"):
        if not part:
            continue
        fields[part[:1].decode(errors="ignore")] = part[1:].decode(errors="replace")
    return fields


def _parse_row_description(payload: bytes):
    (nfields,) = struct.unpack("!h", payload[:2])
    pos = 2
    names = []
    for _ in range(nfields):
        end = payload.index(b"\x00", pos)
        names.append(payload[pos:end].decode())
        pos = end + 1 + 4 + 2 + 4 + 2 + 4 + 2  # oid, attnum, typoid, typlen, typmod, fmt
    return names


def _parse_data_row(payload: bytes, columns: list[str]) -> dict:
    (nfields,) = struct.unpack("!h", payload[:2])
    pos = 2
    row = {}
    for i in range(nfields):
        (length,) = struct.unpack("!i", payload[pos:pos + 4])
        pos += 4
        if length == -1:
            value = None
        else:
            raw = payload[pos:pos + length]
            pos += length
            try:
                value = raw.decode()
            except UnicodeDecodeError:
                value = raw.hex()
        row[columns[i] if i < len(columns) else f"col{i}"] = value
    return row


class ScramSha256:
    def __init__(self, password: str):
        self.password = password
        self.client_nonce = base64.b64encode(os.urandom(18)).decode()
        self._server_signature = None

    def client_first(self) -> bytes:
        self.first_bare = f"n=,r={self.client_nonce}"
        return ("n,," + self.first_bare).encode()

    def client_final(self, server_first: bytes) -> bytes:
        msg = server_first.decode()
        attrs = dict(item.split("=", 1) for item in msg.split(",") if "=" in item)
        nonce = attrs["r"]
        salt = base64.b64decode(attrs["s"])
        iterations = int(attrs["i"])
        if not nonce.startswith(self.client_nonce):
            raise ConnectionError("SCRAM nonce mismatch")

        salted = hashlib.pbkdf2_hmac("sha256", self.password.encode(), salt, iterations)
        client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
        stored_key = hashlib.sha256(client_key).digest()

        without_proof = f"c=biws,r={nonce}"
        auth_message = f"{self.first_bare},{msg},{without_proof}".encode()

        client_signature = hmac.new(stored_key, auth_message, hashlib.sha256).digest()
        proof = bytes(a ^ b for a, b in zip(client_key, client_signature))

        server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
        self._server_signature = hmac.new(server_key, auth_message, hashlib.sha256).digest()

        return f"{without_proof},p={base64.b64encode(proof).decode()}".encode()

    def verify_server(self, payload: bytes):
        text = payload.decode()
        attrs = dict(item.split("=", 1) for item in text.split(",") if "=" in item)
        if "v" in attrs:
            if base64.b64decode(attrs["v"]) != self._server_signature:
                raise ConnectionError("server signature verification failed")
        if "e" in attrs:
            raise ConnectionError(f"SCRAM server error: {attrs['e']}")


def _split_hostport(hostpart: str) -> tuple[str, int]:
    if hostpart.startswith("["):  # [ipv6]:port
        end = hostpart.index("]")
        host = hostpart[1:end]
        rest = hostpart[end + 1:]
        port = int(rest[1:]) if rest.startswith(":") else 5432
        return host, port
    if hostpart.count(":") > 1:  # bare IPv6
        return hostpart, 5432
    if ":" in hostpart:
        host, _, port = hostpart.rpartition(":")
        return host, int(port)
    return hostpart, 5432


def connect_from_dsn(dsn: str | None = None, **overrides) -> PG:
    """Parse a postgres URI manually.

    urllib refuses bracketed passwords, which is exactly how the Supabase
    dashboard formats them, so the netloc is split by hand.
    """
    dsn = dsn or os.environ.get("SB_DSN") or os.environ.get("DATABASE_URL")
    if not dsn:
        raise ValueError("no DSN provided (set SB_DSN or pass dsn=)")

    scheme, sep, rest = dsn.partition("://")
    if not sep:
        raise ValueError("DSN must look like postgresql://user:pass@host:port/db")
    if scheme not in ("postgres", "postgresql"):
        raise ValueError(f"unsupported DSN scheme: {scheme}")

    # Strip query string, then split credentials from host at the LAST '@'.
    rest, _, query = rest.partition("?")
    userinfo, at, hostpath = rest.rpartition("@")
    if not at:
        raise ValueError("DSN is missing user:password@")

    if ":" in userinfo:
        user_raw, _, password_raw = userinfo.partition(":")
    else:
        user_raw, password_raw = userinfo, ""

    # Brackets around the password are dashboard decoration, not part of it.
    if password_raw.startswith("[") and password_raw.endswith("]"):
        password_raw = password_raw[1:-1]

    hostpart, _, dbpath = hostpath.partition("/")
    host, port = _split_hostport(hostpart)
    dbname = dbpath or "postgres"

    qs = {}
    for item in query.split("&"):
        if "=" in item:
            k, v = item.split("=", 1)
            qs[k] = unquote(v)

    return PG(
        host=host,
        port=port,
        user=unquote(user_raw) or "postgres",
        password=unquote(password_raw),
        dbname=dbname,
        sslmode=qs.get("sslmode", "require"),
        **overrides,
    )
