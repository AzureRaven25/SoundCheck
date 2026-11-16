"""Database connection and schema setup."""

from __future__ import annotations

import os
import re
from importlib.resources import files

import psycopg
from psycopg import sql

DEFAULT_DSN = "postgresql:///karaoke"


def dsn() -> str:
    return os.environ.get("KARAOKE_DATABASE_URL", DEFAULT_DSN)


def read_sql(name: str) -> str:
    return files("karaoke_catalog.sql").joinpath(name).read_text()


def ensure_database(target_dsn: str | None = None) -> None:
    """Create the target database if it doesn't exist (needs access to the `postgres` db)."""
    info = psycopg.conninfo.conninfo_to_dict(target_dsn or dsn())
    dbname = info.get("dbname") or "karaoke"
    admin = psycopg.conninfo.make_conninfo(target_dsn or dsn(), dbname="postgres")
    with psycopg.connect(admin, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)).fetchone()
        if not exists:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dbname)))


def connect(target_dsn: str | None = None, **kwargs) -> psycopg.Connection:
    return psycopg.connect(target_dsn or dsn(), **kwargs)


def init_schema(conn: psycopg.Connection) -> None:
    conn.execute(read_sql("schema.sql"))
    conn.execute(read_sql("indexes.sql"))
    conn.commit()


def index_names() -> list[str]:
    return re.findall(r"CREATE INDEX IF NOT EXISTS (\w+)", read_sql("indexes.sql"))
