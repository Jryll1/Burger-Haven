#!/usr/bin/env python3
"""Burger Haven account role manager (run on the server, from the Burger_Haven_App folder).

Roles:
  customer  storefront, cart, checkout, My Orders (default for every account)
  staff     customer features + staff dashboard (orders, payments, menu)
  admin     everything staff can do + administrator analytics

Roles can only be granted here, from the server. Public registration always creates customers.

Examples:
  python manage_users.py list
  python manage_users.py set-role owner@example.com admin
  python manage_users.py set-role cashier@example.com staff
  python manage_users.py set-role cashier@example.com customer
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ROLES = ("customer", "staff", "admin")


def database_path() -> Path:
    load_dotenv(BASE_DIR / ".env")
    configured = Path(os.getenv("DATABASE_PATH", str(BASE_DIR / "burger_haven.db"))).expanduser()
    if not configured.is_absolute():
        configured = BASE_DIR / configured
    return configured.resolve()


def connect(path: Path) -> sqlite3.Connection:
    if not path.exists():
        sys.exit(f"Database not found at {path}. Start the app once (or check DATABASE_PATH in .env) first.")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    tables = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "users" not in tables:
        sys.exit("This database has no users table yet. Start the app once so it can create it.")
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    if "role" not in columns:  # same additive migration the app performs at startup
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'")
        conn.commit()
    return conn


def list_users(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id,full_name,email,role FROM users ORDER BY id").fetchall()
    if not rows:
        print("No accounts yet.")
        return
    print(f"{'ID':<5}{'ROLE':<10}{'EMAIL':<36}NAME")
    for row in rows:
        print(f"{row['id']:<5}{row['role']:<10}{row['email']:<36}{row['full_name']}")


def set_role(conn: sqlite3.Connection, email: str, role: str) -> None:
    row = conn.execute("SELECT id,role FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone()
    if row is None:
        sys.exit(f"No account with email {email!r}. The person must register on the storefront first.")
    if row["role"] == "admin" and role != "admin":
        remaining = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND id<>?", (row["id"],)).fetchone()[0]
        print("Note: this removes the last administrator account. The ADMIN_TOKEN in .env still works." if remaining == 0 else "")
    conn.execute("UPDATE users SET role=?,updated_at=? WHERE id=?", (role, datetime.now(timezone.utc).isoformat(timespec="seconds"), row["id"]))
    conn.commit()
    print(f"{email}: {row['role']} -> {role}. Takes effect on their next request; no restart needed.")


def main() -> None:
    parser = argparse.ArgumentParser(description="List Burger Haven accounts and set their role.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="show all accounts and their roles")
    setter = sub.add_parser("set-role", help="set an account's role")
    setter.add_argument("email")
    setter.add_argument("role", choices=ROLES)
    args = parser.parse_args()
    path = database_path()
    conn = connect(path)
    try:
        print(f"Database: {path}")
        if args.command == "list":
            list_users(conn)
        else:
            set_role(conn, args.email.strip(), args.role)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
