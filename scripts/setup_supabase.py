#!/usr/bin/env python3
"""Apply BuildLedger's schema to the configured Supabase PostgreSQL database.

This intentionally prompts for the database password at runtime. It does not
write credentials to the project or print them to the terminal.
"""

from getpass import getpass
from pathlib import Path
import os
import sys

try:
    import psycopg
except ImportError:
    sys.exit("Install psycopg first, then rerun this script.")


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_FILE = ROOT / "supabase-schema.sql"
HOST = os.environ.get("SUPABASE_DB_HOST", "db.vqlrnstartnesekwjwfl.supabase.co")
USER = os.environ.get("SUPABASE_DB_USER", "postgres")
DATABASE = os.environ.get("SUPABASE_DB_NAME", "postgres")
PORT = int(os.environ.get("SUPABASE_DB_PORT", "5432"))


def main() -> None:
    password = getpass(f"Password for {USER}@{HOST}: ")
    if not password:
        sys.exit("No password entered; schema was not changed.")

    schema = SCHEMA_FILE.read_text(encoding="utf-8")
    try:
        with psycopg.connect(
            host=HOST,
            port=PORT,
            user=USER,
            password=password,
            dbname=DATABASE,
            sslmode="require",
            connect_timeout=15,
            autocommit=True,
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute(schema)
                cursor.execute(
                    "select policyname from pg_policies "
                    "where schemaname = 'public' and tablename = 'construction_expenses'"
                )
                policies = cursor.fetchall()
    except psycopg.Error as error:
        sys.exit(f"Supabase setup failed: {error}")

    if policies:
        sys.exit("Supabase setup failed: browser-access policies still exist on construction_expenses.")

    print("BuildLedger schema applied successfully; anonymous table policies are disabled.")


if __name__ == "__main__":
    main()
