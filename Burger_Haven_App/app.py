from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Generator, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def configured_path(variable_name: str, default: Path) -> Path:
    """Resolve filesystem paths from environment variables, relative to the app folder."""
    configured = Path(os.getenv(variable_name, str(default))).expanduser()
    if not configured.is_absolute():
        configured = BASE_DIR / configured
    return configured.resolve()


# Railway can mount one persistent volume at /data. Keeping the SQLite database
# and private receipt uploads on that volume preserves them across redeploys.
UPLOAD_DIR = configured_path("UPLOAD_DIR", BASE_DIR / "uploads")
DB_PATH = configured_path("DATABASE_PATH", BASE_DIR / "burger_haven.db")
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()
STAFF_TOKEN = os.getenv("STAFF_TOKEN", "").strip()
MAX_RECEIPT_BYTES = 5 * 1024 * 1024
ALLOWED_RECEIPT_MIMES = {"image/jpeg", "image/png", "image/webp"}

PRODUCTS = [
    {"id": "classic-burger", "name": "Classic Burger", "category": "Burgers", "description": "Juicy beef patty, fresh lettuce, tomato, cheese, and house sauce.", "price": 120, "image": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80", "available": True, "featured": True},
    {"id": "bbq-bacon-burger", "name": "BBQ Bacon Burger", "category": "Burgers", "description": "Smoky BBQ sauce, crispy bacon, cheese, and a grilled beef patty.", "price": 150, "image": "https://images.unsplash.com/photo-1553979459-d2229ba7433a?auto=format&fit=crop&w=900&q=80", "available": True, "featured": True},
    {"id": "spicy-burger", "name": "Spicy Burger", "category": "Burgers", "description": "Beef, peppery spicy sauce, lettuce, tomato, and melted cheese.", "price": 140, "image": "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=900&q=80", "available": True, "featured": False},
    {"id": "double-cheeseburger", "name": "Double Cheeseburger", "category": "Burgers", "description": "Two beef patties, double cheese, pickles, and special sauce.", "price": 180, "image": "https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=80", "available": True, "featured": True},
    {"id": "crispy-fries", "name": "Crispy Fries", "category": "Sides", "description": "Golden fries, lightly seasoned and served hot.", "price": 40, "image": "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80", "available": True, "featured": False},
    {"id": "onion-rings", "name": "Onion Rings", "category": "Sides", "description": "Crunchy onion rings with a golden coating.", "price": 55, "image": "https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80", "available": True, "featured": False},
    {"id": "soft-drink", "name": "Soft Drink", "category": "Drinks", "description": "Choose Sprint, Sprite, Royal, Coke, or Pepsi in small, regular, or large sizes.", "price": 25, "image": "https://images.unsplash.com/photo-1581006852262-e4307cf6283a?auto=format&fit=crop&w=900&q=80", "available": True, "featured": False},
    {"id": "burger-combo", "name": "Burger Combo", "category": "Combos", "description": "Classic Burger with fries and your choice of soft drink brand and size.", "price": 175, "image": "https://images.unsplash.com/photo-1551782450-a2132b4ba21d?auto=format&fit=crop&w=900&q=80", "available": True, "featured": True},
]

# Additional editable sample catalogue requested for Burger Haven. Prices are initial
# business defaults; confirm them before accepting real orders.
PRODUCTS.extend([
    {"id":"beef-burger-b1t1","name":"Beef Burger Sandwich — B1T1","category":"Buy 1 Take 1","description":"Classic beef patty with mayonnaise and ketchup. One order includes two sandwiches.","price":44,"image":"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80","available":True,"featured":True},
    {"id":"cheeseburger-b1t1","name":"Cheeseburger Sandwich — B1T1","category":"Buy 1 Take 1","description":"Beef patty with melted cheese, mayonnaise, and ketchup. One order includes two sandwiches.","price":58,"image":"https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=80","available":True,"featured":True},
    {"id":"cheesy-hotdog-b1t1","name":"Cheesy Hotdog Sandwich — B1T1","category":"Hotdogs & Sausages","description":"Cheesy hotdog sandwich promotion. One order includes two sandwiches.","price":44,"image":"https://images.unsplash.com/photo-1612392062798-2dbaa8f4c5d6?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"jumbo-cheese-footlong","name":"Jumbo Cheese Footlong","category":"Hotdogs & Sausages","description":"Jumbo footlong sausage topped with cheese.","price":60,"image":"https://images.unsplash.com/photo-1612392062798-2dbaa8f4c5d6?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"cheesy-hungarian","name":"Cheesy Hungarian Sandwich","category":"Hotdogs & Sausages","description":"Hungarian sausage with melted cheese in a toasted bun.","price":70,"image":"https://images.unsplash.com/photo-1612392062798-2dbaa8f4c5d6?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"ham-sandwich","name":"Ham Sandwich","category":"Ham Sandwiches","description":"Classic savory ham sandwich.","price":26,"image":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"ham-cheese-sandwich","name":"Ham and Cheese Sandwich","category":"Ham Sandwiches","description":"Ham and melted cheese in soft bread.","price":33,"image":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"ham-egg-sandwich","name":"Ham and Egg Sandwich","category":"Ham Sandwiches","description":"Ham and egg sandwich.","price":43,"image":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"ham-cheese-egg-sandwich","name":"Ham, Cheese, and Egg Sandwich","category":"Ham Sandwiches","description":"Ham, cheese, and egg in a satisfying sandwich.","price":50,"image":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"bacon-sandwich","name":"Bacon Sandwich","category":"Bacon Sandwiches","description":"Smoky bacon in a toasted sandwich.","price":36,"image":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"bacon-cheese-sandwich","name":"Bacon and Cheese Sandwich","category":"Bacon Sandwiches","description":"Crispy bacon and melted cheese.","price":43,"image":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"bacon-cheese-egg-sandwich","name":"Bacon, Cheese, and Egg Sandwich","category":"Bacon Sandwiches","description":"Bacon, cheese, and egg in a toasted sandwich.","price":60,"image":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"egg-sandwich","name":"Egg Sandwich","category":"Egg & Specialty Sandwiches","description":"A simple egg sandwich.","price":33,"image":"https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"tater-tots","name":"Tater Tots","category":"Sides","description":"Crispy potato bites served hot.","price":55,"image":"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"potato-wedges","name":"Potato Wedges","category":"Sides","description":"Seasoned, golden potato wedges.","price":55,"image":"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"fried-pickles","name":"Fried Pickles","category":"Sides","description":"Tangy pickles in a crisp golden coating.","price":60,"image":"https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"jalapeno-poppers","name":"Jalapeño Poppers","category":"Sides","description":"Crispy jalapeño bites with a cheesy filling.","price":70,"image":"https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"cheese-curds","name":"Cheese Curds","category":"Sides","description":"Bite-size cheese with a crisp coating.","price":75,"image":"https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"sweet-potato-fries","name":"Sweet Potato Fries","category":"Sides","description":"Crispy sweet potato fries.","price":60,"image":"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"fried-zucchini","name":"Fried Zucchini","category":"Sides","description":"Crispy battered zucchini pieces.","price":60,"image":"https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"creamy-coleslaw","name":"Creamy Coleslaw","category":"Sides","description":"Shredded cabbage with a cool, tangy dressing.","price":35,"image":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"potato-salad","name":"Potato Salad","category":"Sides","description":"Creamy potato salad.","price":40,"image":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"pasta-salad","name":"Pasta or Orzo Salad","category":"Sides","description":"Chilled pasta salad with fresh ingredients.","price":45,"image":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"cucumber-tomato-salad","name":"Cucumber and Tomato Salad","category":"Sides","description":"Refreshing cucumber and tomato salad.","price":40,"image":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"smoky-baked-beans","name":"Smoky Baked Beans","category":"Sides","description":"Sweet and savory baked beans.","price":45,"image":"https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"mac-and-cheese","name":"Macaroni and Cheese","category":"Sides","description":"Creamy macaroni and cheese.","price":55,"image":"https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"mexican-street-corn","name":"Mexican Street Corn","category":"Sides","description":"Street-style corn with a creamy, savory topping.","price":50,"image":"https://images.unsplash.com/photo-1551754655-cd27e38d2076?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"bottled-water","name":"Bottled Mineral Water","category":"Drinks","description":"Bottled mineral water. Confirm actual bottle volumes in menu settings.","price":25,"image":"https://images.unsplash.com/photo-1559839914-17aae19cec71?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
    {"id":"lipton-iced-tea","name":"Lipton Iced Tea","category":"Drinks","description":"Refreshing iced tea. Available cup or package sizes must be confirmed by the owner.","price":46,"image":"https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80","available":True,"featured":False},
])
PRODUCT_BY_ID = {p["id"]: p for p in PRODUCTS}
ADDONS = {"extra-cheese": {"name": "Extra cheese", "price": 20}, "bacon": {"name": "Bacon", "price": 30}}
# Configurable sample prices in Philippine pesos. Edit here to update every checkout price.
DRINK_VARIANTS = {
    "brands": ["Sprint", "Sprite", "Royal", "Coke", "Pepsi"],
    "additional_brands": ["7-Up", "Mirinda", "Mountain Dew"],
    "sizes": [
        {"id": "small", "label": "Small (250 ml)", "price": 25},
        {"id": "regular", "label": "Medium (330 ml)", "price": 35},
        {"id": "large", "label": "Large (500 ml)", "price": 50},
    ],
    "additional_sizes": [{"id": "xl", "label": "XL (700 ml)", "price": 60}],
}
DRINK_SIZE_BY_ID = {size["id"]: size for size in (DRINK_VARIANTS["sizes"] + DRINK_VARIANTS["additional_sizes"])}
DRINK_BRANDS = DRINK_VARIANTS["brands"] + DRINK_VARIANTS["additional_brands"]
SIZE_LABELS = {"small": "Small", "medium": "Medium", "large": "Large", "xl": "XL"}
SIDE_SIZE_PRICES = {
    "crispy-fries": {"small":35,"medium":50,"large":70,"xl":90}, "onion-rings":{"small":45,"medium":60,"large":80,"xl":100},
    "tater-tots":{"small":40,"medium":55,"large":75,"xl":95}, "potato-wedges":{"small":40,"medium":55,"large":75,"xl":95},
    "fried-pickles":{"small":45,"medium":60,"large":80,"xl":100}, "jalapeno-poppers":{"small":50,"medium":70,"large":90,"xl":115},
    "cheese-curds":{"small":55,"medium":75,"large":100,"xl":125}, "sweet-potato-fries":{"small":45,"medium":60,"large":85,"xl":110},
    "fried-zucchini":{"small":45,"medium":60,"large":80,"xl":100}, "creamy-coleslaw":{"small":25,"medium":35,"large":50,"xl":65},
    "potato-salad":{"small":30,"medium":40,"large":55,"xl":70}, "pasta-salad":{"small":35,"medium":45,"large":60,"xl":75},
    "cucumber-tomato-salad":{"small":30,"medium":40,"large":55,"xl":70}, "smoky-baked-beans":{"small":30,"medium":45,"large":60,"xl":80},
    "mac-and-cheese":{"small":40,"medium":55,"large":75,"xl":95}, "mexican-street-corn":{"small":35,"medium":50,"large":70,"xl":90},
    "bottled-water":{"small":23,"medium":25,"large":28,"xl":30}, "lipton-iced-tea":{"small":43,"medium":46,"large":49,"xl":52},
}
B1T1_IDS = {"beef-burger-b1t1", "cheeseburger-b1t1", "cheesy-hotdog-b1t1"}

def size_variants_for(product: dict[str, Any]) -> list[dict[str, Any]]:
    if product["id"] in {"soft-drink", "burger-combo"} or product["id"] in B1T1_IDS:
        return []
    base = int(product["price"])
    price_map = None
    raw_sizes = product.get("sizes_json") or ""
    if raw_sizes:
        try:
            configured_sizes = json.loads(raw_sizes) if isinstance(raw_sizes, str) else raw_sizes
            if isinstance(configured_sizes, dict) and all(size in configured_sizes for size in ("small", "medium", "large", "xl")):
                price_map = {size: int(configured_sizes[size]) for size in ("small", "medium", "large", "xl")}
        except (TypeError, ValueError, json.JSONDecodeError):
            price_map = None
    if price_map is None:
        price_map = SIDE_SIZE_PRICES.get(product["id"])
    if price_map is None:
        price_map = {"small": base, "medium": base + 10, "large": base + 20, "xl": base + 30}
    return [{"id": size, "label": SIZE_LABELS[size], "price": int(price_map[size]), "capacity_ml": ({"small":250,"medium":350,"large":500,"xl":700}.get(size) if product.get("id") == "soft-drink" else None)} for size in ("small", "medium", "large", "xl")]

@asynccontextmanager
async def lifespan(application: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Burger Haven", version="1.0.0", description="Burger Haven order management with manual payment verification. No payment gateway APIs are used.", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.middleware("http")
async def prevent_stale_application_pages(request: Request, call_next):
    """Make browsers revalidate app shells so old customer/admin navigation cannot persist."""
    response = await call_next(request)
    if request.url.path in {"/", "/admin", "/analytics", "/admin.html", "/analytics.html"}:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def next_version_stamp(previous: Optional[str]) -> str:
    """updated_at doubles as the optimistic-concurrency version, but it only has one-second
    precision. Guarantee every write produces a strictly newer value so two changes made inside
    the same second cannot look identical to the stale-edit check."""
    current = datetime.now(timezone.utc).replace(microsecond=0)
    if previous:
        try:
            last = datetime.fromisoformat(previous)
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if current <= last:
                current = last + timedelta(seconds=1)
        except ValueError:
            pass
    return current.isoformat(timespec="seconds")


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@contextmanager
def db_connection() -> Generator[sqlite3.Connection, None, None]:
    connection = sqlite3.connect(DB_PATH, timeout=10, isolation_level="DEFERRED")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db_connection() as conn:
        conn.executescript("""
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            price INTEGER NOT NULL CHECK (price >= 0),
            image TEXT NOT NULL DEFAULT '',
            available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
            featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
            sizes_json TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category, available);
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_id TEXT NOT NULL UNIQUE,
            idempotency_key TEXT NOT NULL UNIQUE,
            access_token_hash TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('delivery','pickup')),
            address TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','gcash','maya')),
            payment_status TEXT NOT NULL,
            order_status TEXT NOT NULL,
            subtotal INTEGER NOT NULL,
            delivery_fee INTEGER NOT NULL DEFAULT 0,
            total INTEGER NOT NULL,
            transaction_reference TEXT NOT NULL DEFAULT '',
            receipt_filename TEXT NOT NULL DEFAULT '',
            payment_claim_at TEXT NOT NULL DEFAULT '',
            payment_decision_reason TEXT NOT NULL DEFAULT '',
            verified_by TEXT NOT NULL DEFAULT '',
            verified_at TEXT NOT NULL DEFAULT '',
            cash_collected_by TEXT NOT NULL DEFAULT '',
            cash_collected_at TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            phone TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS customer_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_customer_sessions_user ON customer_sessions(user_id);
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            unit_price INTEGER NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
            addons_json TEXT NOT NULL DEFAULT '[]',
            line_total INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS order_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            actor TEXT NOT NULL DEFAULT 'system',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS order_edit_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            customer_user_id INTEGER NOT NULL REFERENCES users(id),
            old_items_json TEXT NOT NULL,
            new_items_json TEXT NOT NULL,
            old_subtotal INTEGER NOT NULL,
            new_subtotal INTEGER NOT NULL,
            old_total INTEGER NOT NULL,
            new_total INTEGER NOT NULL,
            old_updated_at TEXT NOT NULL,
            new_updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status, payment_status);
        CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id, created_at);
        """)
        # Safe, additive migrations for account ownership and editable size variants.
        product_columns = {row["name"] for row in conn.execute("PRAGMA table_info(products)").fetchall()}
        if "sizes_json" not in product_columns:
            conn.execute("ALTER TABLE products ADD COLUMN sizes_json TEXT NOT NULL DEFAULT ''")
        order_columns = {row["name"] for row in conn.execute("PRAGMA table_info(orders)").fetchall()}
        if "customer_user_id" not in order_columns:
            conn.execute("ALTER TABLE orders ADD COLUMN customer_user_id INTEGER REFERENCES users(id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_customer_user ON orders(customer_user_id, created_at DESC)")
        # Account roles: every existing account becomes a plain customer. Staff/admin roles are
        # granted only from the server with manage_users.py, never through public registration.
        user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "role" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'")
        timestamp = now_iso()
        for product in PRODUCTS:
            conn.execute("""INSERT OR IGNORE INTO products
                (id,name,category,description,price,image,available,featured,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)""", (
                product["id"], product["name"], product["category"], product["description"], product["price"],
                product["image"], int(product["available"]), int(product["featured"]), timestamp, timestamp,
            ))
        # Update only the original seed descriptions; preserve any description edited by staff.
        conn.execute("UPDATE products SET description=? WHERE id='soft-drink' AND description='A chilled canned soft drink.'", (
            "Choose Sprint, Sprite, Royal, Coke, or Pepsi in small, regular, or large sizes.",
        ))
        conn.execute("UPDATE products SET description=? WHERE id='burger-combo' AND description='Classic Burger with fries and a soft drink.'", (
            "Classic Burger with fries and your choice of soft drink brand and size.",
        ))


def add_event(conn: sqlite3.Connection, order_id: int, event_type: str, details: str = "", actor: str = "system") -> None:
    conn.execute(
        "INSERT INTO order_events (order_id,event_type,details,actor,created_at) VALUES (?,?,?,?,?)",
        (order_id, event_type, details[:500], actor[:120], now_iso()),
    )


def get_order_by_public_id(conn: sqlite3.Connection, public_id: str) -> Optional[sqlite3.Row]:
    return conn.execute("SELECT * FROM orders WHERE public_id = ?", (public_id,)).fetchone()


def order_items(conn: sqlite3.Connection, order_id: int) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", (order_id,)).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        stored = json.loads(item.pop("addons_json") or "[]")
        if isinstance(stored, dict):
            item["addons"] = stored.get("addons", [])
            item["options"] = stored.get("options", {})
        else:  # backward compatibility for existing orders saved before size variants
            item["addons"] = stored if isinstance(stored, list) else []
            item["options"] = {}
        result.append(item)
    return result


def order_editability(row: sqlite3.Row) -> tuple[bool, str]:
    if row["customer_user_id"] is None:
        return False, "This order was placed as a guest. Only orders linked to your signed-in account can be edited."
    if row["order_status"] not in {"Pending Confirmation", "Confirmed"}:
        return False, "This order can no longer be edited because preparation has started or the order is already closed."
    if row["payment_status"] in {"Paid", "Awaiting Verification"}:
        return False, "This order has already been paid or submitted for payment verification. Contact Burger Haven before making changes."
    return True, ""


def public_order(conn: sqlite3.Connection, row: sqlite3.Row, include_events: bool = False) -> dict[str, Any]:
    result = {key: row[key] for key in row.keys() if key not in {"idempotency_key", "access_token_hash", "receipt_filename", "cash_collected_by"}}
    result["items"] = order_items(conn, row["id"])
    result["has_receipt"] = bool(row["receipt_filename"])
    result["can_edit"], result["edit_reason"] = order_editability(row)
    if include_events:
        events = conn.execute("SELECT event_type, details, actor, created_at FROM order_events WHERE order_id = ? ORDER BY id", (row["id"],)).fetchall()
        result["events"] = [dict(e) for e in events]
    return result


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return "pbkdf2_sha256$310000$" + salt.hex() + "$" + digest.hex()


def password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations))
        return secrets.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def issue_customer_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(40)
    now = datetime.now(timezone.utc)
    expires = (now.replace(microsecond=0) + __import__("datetime").timedelta(days=7)).isoformat()
    conn.execute("DELETE FROM customer_sessions WHERE expires_at <= ?", (now.isoformat(),))
    conn.execute("INSERT INTO customer_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)", (hash_secret(token), user_id, expires, now.isoformat()))
    return token


def get_customer_by_token(token: Optional[str]) -> Optional[dict[str, Any]]:
    if not token or len(token) < 32:
        return None
    with db_connection() as conn:
        row = conn.execute("""SELECT u.id,u.full_name,u.email,u.phone,u.role,s.expires_at
            FROM customer_sessions s JOIN users u ON u.id=s.user_id
            WHERE s.token_hash=?""", (hash_secret(token),)).fetchone()
        if row is None:
            return None
        if row["expires_at"] <= now_iso():
            conn.execute("DELETE FROM customer_sessions WHERE token_hash=?", (hash_secret(token),))
            return None
        return {"id": row["id"], "full_name": row["full_name"], "email": row["email"], "phone": row["phone"], "role": row["role"] if row["role"] in ROLE_RANK else "customer"}


def product_variant_price(product: dict[str, Any], size_id: str) -> int:
    variant = next((entry for entry in size_variants_for(product) if entry["id"] == size_id), None)
    if variant is None:
        raise HTTPException(status_code=422, detail="That size is not available for this product.")
    return int(variant["price"])


def configured_account(method: str) -> dict[str, str]:
    prefix = method.upper()
    name = os.getenv(f"{prefix}_ACCOUNT_NAME", "").strip()
    number = os.getenv(f"{prefix}_NUMBER", "").strip()
    qr = os.getenv(f"{prefix}_QR_IMAGE", "").strip()
    return {"account_name": name, "number": number, "qr_image": qr, "configured": bool(name and number and "replace" not in name.lower() and "replace" not in number.lower())}


ROLE_RANK = {"customer": 0, "staff": 1, "admin": 2}
TOKEN_PLACEHOLDER = "replace-with-a-long-random-token"


def token_equals(supplied: str, expected: str) -> bool:
    # Compare as bytes: secrets.compare_digest raises TypeError on non-ASCII str, which used
    # to turn a header such as "X-Admin-Token: caf\u00e9" into a 500 error instead of a 401.
    return secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


def admin_token_usable() -> bool:
    return bool(ADMIN_TOKEN) and TOKEN_PLACEHOLDER not in ADMIN_TOKEN.lower()


def shared_token_role(token: Optional[str]) -> Optional[str]:
    """Role granted by the shared .env tokens (kept for backward compatibility), or None."""
    if not token:
        return None
    if admin_token_usable() and token_equals(token, ADMIN_TOKEN):
        return "admin"
    if STAFF_TOKEN and token_equals(token, STAFF_TOKEN):
        return "staff"
    return None


def require_role(minimum: str, admin_token: Optional[str], customer_token: Optional[str]) -> str:
    """Server-side access check shared by every staff/admin endpoint.

    Credentials are either a shared token (X-Admin-Token) or a signed-in account session
    (X-Customer-Token) whose account role is 'staff' or 'admin'. Returns the acting role.
    """
    token_role = shared_token_role(admin_token)
    if token_role and ROLE_RANK[token_role] >= ROLE_RANK[minimum]:
        return token_role
    if customer_token:
        user = get_customer_by_token(customer_token)
        if user is None:
            raise HTTPException(status_code=401, detail="Your sign-in has expired. Please sign in again.")
        if ROLE_RANK[user["role"]] >= ROLE_RANK[minimum]:
            return user["role"]
        if user["role"] == "staff":
            raise HTTPException(status_code=403, detail="Analytics and business reports are limited to administrator accounts.")
        raise HTTPException(status_code=403, detail="This account does not have staff access. Customer accounts cannot open staff or administrator pages.")
    if token_role:  # a valid shared staff token trying to reach an administrator-only endpoint
        raise HTTPException(status_code=401, detail="Invalid admin token.")
    if admin_token:
        if not ADMIN_TOKEN and not STAFF_TOKEN:
            raise HTTPException(status_code=503, detail="Admin access is not configured. Copy .env.example to .env, set ADMIN_TOKEN, then restart the server.")
        if ADMIN_TOKEN and not admin_token_usable() and not STAFF_TOKEN:
            raise HTTPException(status_code=503, detail="ADMIN_TOKEN is still the template placeholder. Copy the updated .env.example or replace ADMIN_TOKEN in .env, then restart the server.")
        raise HTTPException(status_code=401, detail="Invalid admin token." if (minimum == "admin" or not STAFF_TOKEN) else "Invalid staff access token.")
    raise HTTPException(status_code=401, detail="Sign in with a staff or administrator account, or enter an access token, to continue.")


def admin_guard(x_admin_token: Optional[str] = Header(default=None), x_customer_token: Optional[str] = Header(default=None)) -> str:
    return require_role("admin", x_admin_token, x_customer_token)


def staff_guard(x_admin_token: Optional[str] = Header(default=None), x_customer_token: Optional[str] = Header(default=None)) -> str:
    # Administrators can do everything staff can. Analytics still requires admin_guard.
    return require_role("staff", x_admin_token, x_customer_token)


def order_guard(public_id: str, x_order_token: Optional[str]) -> sqlite3.Row:
    if not x_order_token or len(x_order_token) < 24:
        raise HTTPException(status_code=401, detail="Order access token is required.")
    with db_connection() as conn:
        row = get_order_by_public_id(conn, public_id)
        if row is None or not secrets.compare_digest(row["access_token_hash"], hash_secret(x_order_token)):
            raise HTTPException(status_code=404, detail="Order was not found. Check the order number and access code.")
        return row


class OrderItemInput(BaseModel):
    product_id: str
    quantity: int = Field(ge=1, le=20)
    addons: list[str] = Field(default_factory=list, max_length=4)
    options: dict[str, str] = Field(default_factory=dict)

    @field_validator("options")
    @classmethod
    def validate_options(cls, value: dict[str, str]) -> dict[str, str]:
        if any(key not in {"drink_brand", "drink_size", "product_size"} for key in value):
            raise ValueError("Unsupported product option.")
        brand = value.get("drink_brand", "")
        size = value.get("drink_size", "")
        product_size = value.get("product_size", "")
        if brand and brand not in DRINK_BRANDS:
            raise ValueError("Choose an available soft drink brand.")
        if size and size not in DRINK_SIZE_BY_ID:
            raise ValueError("Choose an available soft drink size.")
        if bool(brand) != bool(size):
            raise ValueError("Choose both a soft drink brand and size.")
        if product_size and product_size not in SIZE_LABELS:
            raise ValueError("Choose an available product size.")
        if product_size and size:
            raise ValueError("Choose a food size or drink size, not both.")
        return value

    @field_validator("addons")
    @classmethod
    def validate_addons(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Duplicate add-ons are not allowed.")
        if any(addon not in ADDONS for addon in value):
            raise ValueError("An add-on is not available.")
        return value



class RegisterInput(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    phone: str = Field(min_length=7, max_length=25)
    password: str = Field(min_length=10, max_length=128)
    confirm_password: str = Field(min_length=10, max_length=128)
    accept_terms: bool = False

    @field_validator("full_name")
    @classmethod
    def clean_full_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2 or any(ord(ch) < 32 for ch in value):
            raise ValueError("Enter your full name.")
        return value

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("phone")
    @classmethod
    def clean_account_phone(cls, value: str) -> str:
        value = value.strip()
        if len(re.sub(r"\D", "", value)) < 7:
            raise ValueError("Enter a valid mobile number.")
        return value

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("Password must contain at least one letter and one number.")
        return value

    @field_validator("confirm_password")
    @classmethod
    def confirm_not_empty(cls, value: str) -> str:
        return value


class LoginInput(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def clean_login_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value


class CreateOrderInput(BaseModel):
    idempotency_key: str = Field(min_length=20, max_length=100)
    access_token: str = Field(min_length=24, max_length=200)
    customer_name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=7, max_length=25)
    fulfillment_type: str
    address: str = Field(default="", max_length=400)
    notes: str = Field(default="", max_length=500)
    payment_method: str
    items: list[OrderItemInput] = Field(min_length=1, max_length=30)

    @field_validator("customer_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 2:
            raise ValueError("Please enter your full name.")
        return cleaned

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, value: str) -> str:
        cleaned = value.strip()
        if len(re.sub(r"\D", "", cleaned)) < 7:
            raise ValueError("Enter a valid contact number.")
        return cleaned

    @field_validator("fulfillment_type")
    @classmethod
    def validate_fulfillment(cls, value: str) -> str:
        if value not in {"delivery", "pickup"}:
            raise ValueError("Choose delivery or pickup.")
        return value

    @field_validator("payment_method")
    @classmethod
    def validate_method(cls, value: str) -> str:
        if value not in {"cash", "gcash", "maya"}:
            raise ValueError("Choose Cash, GCash, or Maya.")
        return value


class EditOrderInput(BaseModel):
    items: list[OrderItemInput] = Field(min_length=1, max_length=30)
    expected_updated_at: Optional[str] = Field(default=None, max_length=64)


def normalize_order_items(items: list[OrderItemInput], catalog: dict[str, dict[str, Any]]) -> tuple[int, list[dict[str, Any]]]:
    """Re-price and validate every item against the authoritative server catalog."""
    subtotal = 0
    normalized_items: list[dict[str, Any]] = []
    for item in items:
        product = catalog.get(item.product_id)
        if not product or not product["available"]:
            raise HTTPException(status_code=400, detail=f"The product '{item.product_id}' is unavailable.")
        if product["id"] in {"soft-drink", "burger-combo"}:
            if not item.options.get("drink_brand") or not item.options.get("drink_size"):
                raise HTTPException(status_code=422, detail="Choose the included soft drink brand and size before checkout.")
            drink_size = DRINK_SIZE_BY_ID[item.options["drink_size"]]
            if item.options.get("product_size"):
                raise HTTPException(status_code=422, detail="Choose a drink option rather than a food size for this product.")
            if item.product_id == "soft-drink":
                if item.addons:
                    raise HTTPException(status_code=422, detail="Add-ons are not available for soft drinks.")
                unit_price = int(drink_size["price"])
                product_name = f"Soft Drink — {item.options['drink_brand']} · {drink_size['label']}"
            else:
                if item.addons:
                    raise HTTPException(status_code=422, detail="Combo customization is limited to the included soft drink selection.")
                regular_price = int(DRINK_SIZE_BY_ID["regular"]["price"])
                unit_price = max(0, int(product["price"]) + int(drink_size["price"]) - regular_price)
                product_name = f"Burger Combo — {item.options['drink_brand']} · {drink_size['label']}"
            item_addons = []
        else:
            if item.options.get("drink_brand") or item.options.get("drink_size"):
                raise HTTPException(status_code=422, detail="Drink flavor options can only be used with soft drinks or the burger combo.")
            base_price = int(product["price"])
            selected_size = item.options.get("product_size", "")
            if selected_size:
                if product["id"] in B1T1_IDS:
                    raise HTTPException(status_code=422, detail="B1T1 promotional items use their listed fixed price.")
                base_price = product_variant_price(product, selected_size)
                product_name = f"{product['name']} · {SIZE_LABELS[selected_size]}"
            else:
                product_name = product["name"]
            addons_total = sum(ADDONS[addon]["price"] for addon in item.addons)
            unit_price = base_price + addons_total
            item_addons = [{"id": addon, **ADDONS[addon]} for addon in item.addons]
        line_total = unit_price * item.quantity
        subtotal += line_total
        normalized_items.append({"product_id": product["id"], "product_name": product_name, "unit_price": unit_price, "quantity": item.quantity, "addons": item_addons, "options": item.options, "line_total": line_total})
    return subtotal, normalized_items


class ProductInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    category: str = Field(min_length=2, max_length=40)
    description: str = Field(default="", max_length=500)
    price: int = Field(ge=0, le=100000)
    image: str = Field(min_length=1, max_length=1000)
    available: bool = True
    featured: bool = False
    size_prices: Optional[dict[str, int]] = None

    @field_validator("size_prices")
    @classmethod
    def validate_size_prices(cls, value: Optional[dict[str, int]]) -> Optional[dict[str, int]]:
        if value is None:
            return value
        required = {"small", "medium", "large", "xl"}
        if set(value) != required:
            raise ValueError("Configure all four size prices: small, medium, large, and xl.")
        if any(not isinstance(price, int) or price < 0 or price > 100000 for price in value.values()):
            raise ValueError("Size prices must be whole peso amounts between 0 and 100000.")
        return value

    @field_validator("name", "category")
    @classmethod
    def clean_product_text(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("This field is required.")
        return value

    @field_validator("image")
    @classmethod
    def validate_image_location(cls, value: str) -> str:
        value = value.strip()
        if not (value.startswith("https://") or value.startswith("/static/")):
            raise ValueError("Use an HTTPS image URL or a local /static/ image path.")
        if any(character in value for character in "\r\n\t"):
            raise ValueError("Image URL contains invalid whitespace.")
        return value


class PaymentDecision(BaseModel):
    decision: str
    reason: str = Field(default="", max_length=500)

    @field_validator("decision")
    @classmethod
    def validate_decision(cls, value: str) -> str:
        if value not in {"approve", "reject"}:
            raise ValueError("Decision must be approve or reject.")
        return value


class StatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        allowed = {"Pending Confirmation", "Confirmed", "Preparing", "Ready for Pickup", "Out for Delivery", "Completed", "Cancelled"}
        if value not in allowed:
            raise ValueError("Invalid order status.")
        return value


@app.get("/", response_class=HTMLResponse)
def home() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html")


@app.get("/admin", response_class=HTMLResponse)
def admin_page() -> FileResponse:
    return FileResponse(BASE_DIR / "admin.html")


@app.get("/analytics", response_class=HTMLResponse)
def analytics_page() -> FileResponse:
    return FileResponse(BASE_DIR / "analytics.html")


@app.get("/admin.html", include_in_schema=False)
def admin_html_alias():
    return FileResponse(BASE_DIR / "admin.html")


@app.get("/analytics.html", include_in_schema=False)
def analytics_html_alias():
    return FileResponse(BASE_DIR / "analytics.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "Burger Haven", "payment_mode": "manual verification; no payment APIs"}


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return {
        "business_name": "Burger Haven",
        "tagline": "Great Burgers. Better Moments.",
        "currency": "PHP",
        "delivery_fee": max(0, min(1000, int(os.getenv("DELIVERY_FEE_PHP", "30")))),
        "minimum_order": max(0, min(10000, int(os.getenv("MINIMUM_ORDER_PHP", "0")))),
        "payments": {
            "cash": {"enabled": os.getenv("CASH_ENABLED", "true").lower() == "true", "cash_on_delivery": os.getenv("CASH_ON_DELIVERY", "true").lower() == "true", "cash_on_pickup": os.getenv("CASH_ON_PICKUP", "true").lower() == "true"},
            "gcash": configured_account("gcash"),
            "maya": configured_account("maya"),
        },
    }


@app.post("/api/auth/register", status_code=201)
def register_customer(payload: RegisterInput) -> dict[str, Any]:
    if not payload.accept_terms:
        raise HTTPException(status_code=422, detail="Please accept the terms and privacy policy to create an account.")
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    with db_connection() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email=? COLLATE NOCASE", (payload.email,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="An account with this email already exists. Please log in instead.")
        timestamp = now_iso()
        try:
            cursor = conn.execute("INSERT INTO users(full_name,email,phone,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,'customer',?,?)", (payload.full_name, payload.email, payload.phone, password_hash(payload.password), timestamp, timestamp))
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="An account with this email already exists. Please log in instead.")
        user_id = int(cursor.lastrowid)
        token = issue_customer_session(conn, user_id)
        return {"message": "Account created successfully.", "token": token, "user": {"id": user_id, "full_name": payload.full_name, "email": payload.email, "phone": payload.phone, "role": "customer"}}


@app.post("/api/auth/login")
def login_customer(payload: LoginInput) -> dict[str, Any]:
    with db_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE email=? COLLATE NOCASE", (payload.email,)).fetchone()
        if row is None or not password_matches(payload.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        token = issue_customer_session(conn, int(row["id"]))
        return {"message": "Login successful.", "token": token, "user": {"id": row["id"], "full_name": row["full_name"], "email": row["email"], "phone": row["phone"], "role": row["role"] if row["role"] in ROLE_RANK else "customer"}}


@app.get("/api/auth/me")
def customer_me(x_customer_token: Optional[str] = Header(default=None)) -> dict[str, Any]:
    user = get_customer_by_token(x_customer_token)
    if user is None:
        raise HTTPException(status_code=401, detail="Please log in again to access your account.")
    return {"user": user}


@app.post("/api/auth/logout")
def logout_customer(x_customer_token: Optional[str] = Header(default=None)) -> dict[str, str]:
    if x_customer_token:
        with db_connection() as conn:
            conn.execute("DELETE FROM customer_sessions WHERE token_hash=?", (hash_secret(x_customer_token),))
    return {"message": "You have been logged out."}


@app.get("/api/auth/orders")
def customer_order_history(x_customer_token: Optional[str] = Header(default=None)) -> dict[str, Any]:
    user = get_customer_by_token(x_customer_token)
    if user is None:
        raise HTTPException(status_code=401, detail="Please log in to view your order history.")
    with db_connection() as conn:
        rows = conn.execute("SELECT * FROM orders WHERE customer_user_id=? ORDER BY created_at DESC LIMIT 100", (user["id"],)).fetchall()
        return {"orders": [public_order(conn, row) for row in rows]}


@app.put("/api/auth/orders/{public_id}")
def edit_customer_order(public_id: str, payload: EditOrderInput, x_customer_token: Optional[str] = Header(default=None)) -> dict[str, Any]:
    user = get_customer_by_token(x_customer_token)
    if user is None:
        raise HTTPException(status_code=401, detail="Please log in to edit your order.")
    config = get_config()
    with db_connection() as conn:
        # Reserve the write lock before checking status/version so concurrent staff updates
        # cannot slip between validation and the replacement of order lines.
        conn.execute("BEGIN IMMEDIATE")
        row = get_order_by_public_id(conn, public_id)
        if row is None or row["customer_user_id"] != user["id"]:
            raise HTTPException(status_code=404, detail="Order was not found in your account history.")
        can_edit, reason = order_editability(row)
        if not can_edit:
            raise HTTPException(status_code=409, detail=reason)
        if payload.expected_updated_at and payload.expected_updated_at != row["updated_at"]:
            raise HTTPException(status_code=409, detail="This order changed since you opened the editor. Refresh your order history and try again.")
        catalog_rows = conn.execute("SELECT id,name,category,description,price,image,available,featured,sizes_json FROM products").fetchall()
        catalog = {item["id"]: dict(item) for item in catalog_rows}
        subtotal, normalized_items = normalize_order_items(payload.items, catalog)
        if subtotal < config["minimum_order"]:
            raise HTTPException(status_code=400, detail=f"The minimum order is ₱{config['minimum_order']}.")
        delivery_fee = config["delivery_fee"] if row["fulfillment_type"] == "delivery" else 0
        total = subtotal + delivery_fee
        old_items = order_items(conn, int(row["id"]))
        old_snapshot = [{"product_id": x["product_id"], "product_name": x["product_name"], "unit_price": x["unit_price"], "quantity": x["quantity"], "addons": x["addons"], "options": x["options"], "line_total": x["line_total"]} for x in old_items]
        new_timestamp = next_version_stamp(row["updated_at"])
        conn.execute("UPDATE orders SET subtotal=?,delivery_fee=?,total=?,updated_at=? WHERE id=? AND updated_at=?", (subtotal, delivery_fee, total, new_timestamp, row["id"], row["updated_at"]))
        if conn.execute("SELECT changes()").fetchone()[0] != 1:
            raise HTTPException(status_code=409, detail="This order was updated elsewhere. Refresh your order history and try again.")
        conn.execute("DELETE FROM order_items WHERE order_id=?", (row["id"],))
        for item in normalized_items:
            conn.execute("INSERT INTO order_items (order_id,product_id,product_name,unit_price,quantity,addons_json,line_total) VALUES (?,?,?,?,?,?,?)", (
                row["id"], item["product_id"], item["product_name"], item["unit_price"], item["quantity"], json.dumps({"addons": item["addons"], "options": item["options"]}), item["line_total"],
            ))
        new_snapshot = [{"product_id": x["product_id"], "product_name": x["product_name"], "unit_price": x["unit_price"], "quantity": x["quantity"], "addons": x["addons"], "options": x["options"], "line_total": x["line_total"]} for x in normalized_items]
        conn.execute("INSERT INTO order_edit_history(order_id,customer_user_id,old_items_json,new_items_json,old_subtotal,new_subtotal,old_total,new_total,old_updated_at,new_updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
            row["id"], user["id"], json.dumps(old_snapshot), json.dumps(new_snapshot), row["subtotal"], subtotal, row["total"], total, row["updated_at"], new_timestamp, new_timestamp,
        ))
        add_event(conn, int(row["id"]), "Customer edited order", f"Items and totals updated: ₱{row['total']} → ₱{total}", "customer")
        updated = conn.execute("SELECT * FROM orders WHERE id=?", (row["id"],)).fetchone()
        return {"message": "Order changes saved successfully.", "order": public_order(conn, updated)}


@app.get("/api/products")
def get_products() -> dict[str, Any]:
    with db_connection() as conn:
        rows = conn.execute("SELECT id,name,category,description,price,image,available,featured,sizes_json FROM products WHERE available=1 ORDER BY featured DESC, category, name").fetchall()
        items = []
        for row in rows:
            item = dict(row)
            item["available"] = bool(item["available"])
            item["featured"] = bool(item["featured"])
            item["sizes"] = size_variants_for(item)
            items.append(item)
        return {"products": items, "addons": ADDONS, "drink_variants": DRINK_VARIANTS, "categories": sorted({item["category"] for item in items})}


@app.post("/api/orders", status_code=201)
def create_order(payload: CreateOrderInput, x_customer_token: Optional[str] = Header(default=None)) -> dict[str, Any]:
    if payload.fulfillment_type == "delivery" and len(payload.address.strip()) < 8:
        raise HTTPException(status_code=422, detail="Please enter a complete delivery address.")
    config = get_config()
    method_config = config["payments"].get(payload.payment_method, {})
    if payload.payment_method == "cash" and not method_config.get("enabled"):
        raise HTTPException(status_code=400, detail="Cash payment is currently unavailable.")
    if payload.payment_method == "cash" and payload.fulfillment_type == "delivery" and not method_config.get("cash_on_delivery"):
        raise HTTPException(status_code=400, detail="Cash on delivery is currently unavailable.")
    if payload.payment_method == "cash" and payload.fulfillment_type == "pickup" and not method_config.get("cash_on_pickup"):
        raise HTTPException(status_code=400, detail="Cash on pickup is currently unavailable.")
    if payload.payment_method in {"gcash", "maya"} and not method_config.get("configured"):
        raise HTTPException(status_code=400, detail=f"{payload.payment_method.upper()} account details are not configured yet. Please choose Cash or contact Burger Haven.")

    customer = get_customer_by_token(x_customer_token)
    with db_connection() as catalog_conn:
        catalog_rows = catalog_conn.execute("SELECT id,name,category,description,price,image,available,featured,sizes_json FROM products").fetchall()
        catalog = {row["id"]: dict(row) for row in catalog_rows}
    subtotal, normalized_items = normalize_order_items(payload.items, catalog)

    if subtotal < config["minimum_order"]:
        raise HTTPException(status_code=400, detail=f"The minimum order is ₱{config['minimum_order']}.")
    delivery_fee = config["delivery_fee"] if payload.fulfillment_type == "delivery" else 0
    total = subtotal + delivery_fee
    timestamp = now_iso()
    public_id = f"BH-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(6).upper()}"
    payment_status = "Unpaid" if payload.payment_method == "cash" else "Unpaid"
    order_status = "Pending Confirmation"

    with db_connection() as conn:
        existing = conn.execute("SELECT * FROM orders WHERE idempotency_key = ?", (payload.idempotency_key,)).fetchone()
        if existing:
            if not secrets.compare_digest(existing["access_token_hash"], hash_secret(payload.access_token)):
                raise HTTPException(status_code=409, detail="This checkout key has already been used. Start a new checkout.")
            return {"order": public_order(conn, existing), "access_token": payload.access_token, "replayed": True}
        try:
            cursor = conn.execute("""INSERT INTO orders (
                public_id,idempotency_key,access_token_hash,customer_name,phone,fulfillment_type,address,notes,payment_method,
                payment_status,order_status,subtotal,delivery_fee,total,created_at,updated_at,customer_user_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                public_id, payload.idempotency_key, hash_secret(payload.access_token), payload.customer_name, payload.phone,
                payload.fulfillment_type, payload.address.strip(), payload.notes.strip(), payload.payment_method,
                payment_status, order_status, subtotal, delivery_fee, total, timestamp, timestamp, customer["id"] if customer else None,
            ))
        except sqlite3.IntegrityError:
            existing = conn.execute("SELECT * FROM orders WHERE idempotency_key = ?", (payload.idempotency_key,)).fetchone()
            if existing and secrets.compare_digest(existing["access_token_hash"], hash_secret(payload.access_token)):
                return {"order": public_order(conn, existing), "access_token": payload.access_token, "replayed": True}
            raise HTTPException(status_code=409, detail="Could not safely create this order. Please start checkout again.")
        order_db_id = int(cursor.lastrowid)
        for item in normalized_items:
            conn.execute("INSERT INTO order_items (order_id,product_id,product_name,unit_price,quantity,addons_json,line_total) VALUES (?,?,?,?,?,?,?)", (
                order_db_id, item["product_id"], item["product_name"], item["unit_price"], item["quantity"], json.dumps({"addons": item["addons"], "options": item["options"]}), item["line_total"],
            ))
        add_event(conn, order_db_id, "Order created", f"{payload.payment_method.upper()} / {payload.fulfillment_type}")
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_db_id,)).fetchone()
        return {"order": public_order(conn, row), "access_token": payload.access_token, "replayed": False}


@app.get("/api/orders/{public_id}")
def track_order(public_id: str, x_order_token: Optional[str] = Header(default=None)) -> dict[str, Any]:
    if not re.fullmatch(r"BH-[0-9]{8}-[A-F0-9]{12}", public_id):
        raise HTTPException(status_code=404, detail="Order was not found.")
    with db_connection() as conn:
        row = get_order_by_public_id(conn, public_id)
        if row is None or not x_order_token or not secrets.compare_digest(row["access_token_hash"], hash_secret(x_order_token)):
            raise HTTPException(status_code=404, detail="Order was not found. Check the order number and access code.")
        return {"order": public_order(conn, row, include_events=True), "payment_instructions": get_config()["payments"].get(row["payment_method"], {})}


@app.post("/api/orders/{public_id}/payment-claim")
def submit_payment_claim(
    public_id: str,
    x_order_token: Optional[str] = Header(default=None),
    transaction_reference: str = Form(..., min_length=4, max_length=120),
    receipt: Optional[UploadFile] = File(default=None),
) -> dict[str, Any]:
    reference = transaction_reference.strip()
    if len(reference) < 4:
        raise HTTPException(status_code=422, detail="Enter the transaction reference shown in your e-wallet receipt.")
    saved_filename = ""
    try:
        with db_connection() as conn:
            row = get_order_by_public_id(conn, public_id)
            if row is None or not x_order_token or not secrets.compare_digest(row["access_token_hash"], hash_secret(x_order_token)):
                raise HTTPException(status_code=404, detail="Order was not found.")
            if row["payment_method"] not in {"gcash", "maya"}:
                raise HTTPException(status_code=400, detail="Only GCash and Maya orders can submit an e-wallet payment claim.")
            if row["payment_status"] == "Paid":
                raise HTTPException(status_code=409, detail="This order is already marked as paid.")
            if row["order_status"] == "Cancelled":
                raise HTTPException(status_code=409, detail="Cancelled orders cannot submit payment claims.")
            if not get_config()["payments"][row["payment_method"]].get("configured"):
                raise HTTPException(status_code=400, detail="The business payment account is not configured yet.")
            if receipt is not None and receipt.filename:
                if receipt.content_type not in ALLOWED_RECEIPT_MIMES:
                    raise HTTPException(status_code=415, detail="Upload a JPG, PNG, or WEBP image only.")
                data = awaitable_read_upload(receipt)
                if len(data) > MAX_RECEIPT_BYTES:
                    raise HTTPException(status_code=413, detail="Receipt image must be 5 MB or smaller.")
                signature_ok = (
                    data.startswith(b"\xff\xd8\xff") if receipt.content_type == "image/jpeg" else
                    data.startswith(b"\x89PNG\r\n\x1a\n") if receipt.content_type == "image/png" else
                    data.startswith(b"RIFF") and data[8:12] == b"WEBP" if receipt.content_type == "image/webp" else False
                )
                if not signature_ok:
                    raise HTTPException(status_code=415, detail="The uploaded file does not match its declared image type.")
                saved_filename = f"{uuid.uuid4().hex}.{ {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[receipt.content_type] }"
                (UPLOAD_DIR / saved_filename).write_bytes(data)
            previous_file = row["receipt_filename"]
            conn.execute("""UPDATE orders SET payment_status='Awaiting Verification',transaction_reference=?,receipt_filename=?,payment_claim_at=?,payment_decision_reason='',verified_by='',verified_at='',updated_at=? WHERE id=?""", (
                reference, saved_filename or previous_file, now_iso(), next_version_stamp(row["updated_at"]), row["id"],
            ))
            add_event(conn, row["id"], "Payment claim submitted", "Transaction reference submitted; staff verification required")
            updated = conn.execute("SELECT * FROM orders WHERE id = ?", (row["id"],)).fetchone()
            return {"message": "Payment claim submitted. Your order will remain unpaid until Burger Haven staff verify the transfer in the business account.", "order": public_order(conn, updated)}
    except Exception:
        if saved_filename:
            try:
                (UPLOAD_DIR / saved_filename).unlink(missing_ok=True)
            except OSError:
                pass
        raise


def awaitable_read_upload(upload: UploadFile) -> bytes:
    # Use the UploadFile's already-spooled, synchronous file object to avoid loading oversized files blindly.
    upload.file.seek(0)
    data = upload.file.read(MAX_RECEIPT_BYTES + 1)
    upload.file.seek(0)
    return data


def product_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (slug[:70] or "new-product")


@app.get("/api/admin/access")
def staff_access_info(role: str = Depends(staff_guard)) -> dict[str, Any]:
    return {"role": role, "permissions": {"manage_orders": True, "manage_menu": True, "analytics": role == "admin"}}


@app.get("/api/admin/products")
def admin_products(_: str = Depends(staff_guard)) -> dict[str, Any]:
    with db_connection() as conn:
        rows = conn.execute("SELECT id,name,category,description,price,image,available,featured,sizes_json,created_at,updated_at FROM products ORDER BY category,name").fetchall()
        result = []
        for row in rows:
            product = dict(row)
            product["available"] = bool(product["available"])
            product["featured"] = bool(product["featured"])
            product["sizes"] = size_variants_for(product)
            product["size_prices"] = {size["id"]: size["price"] for size in product["sizes"]}
            result.append(product)
        return {"products": result, "drink_variants": DRINK_VARIANTS}


@app.post("/api/admin/products", status_code=201)
def create_product(payload: ProductInput, _: str = Depends(staff_guard)) -> dict[str, Any]:
    product_id = product_slug(payload.name)
    timestamp = now_iso()
    with db_connection() as conn:
        if conn.execute("SELECT 1 FROM products WHERE id=?", (product_id,)).fetchone():
            raise HTTPException(status_code=409, detail="A product with a similar name already exists. Edit or rename the existing item.")
        conn.execute("""INSERT INTO products (id,name,category,description,price,image,available,featured,sizes_json,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (product_id, payload.name, payload.category, payload.description.strip(), payload.price, payload.image.strip(), int(payload.available), int(payload.featured), json.dumps(payload.size_prices) if payload.size_prices is not None else "", timestamp, timestamp))
        row = conn.execute("SELECT id,name,category,description,price,image,available,featured,sizes_json,created_at,updated_at FROM products WHERE id=?", (product_id,)).fetchone()
        product = dict(row)
        product["available"] = bool(product["available"])
        product["featured"] = bool(product["featured"])
        product["sizes"] = size_variants_for(product)
        product["size_prices"] = {size["id"]: size["price"] for size in product["sizes"]}
        return {"message": "Product created.", "product": product}


@app.put("/api/admin/products/{product_id}")
def update_product(product_id: str, payload: ProductInput, _: str = Depends(staff_guard)) -> dict[str, Any]:
    timestamp = now_iso()
    with db_connection() as conn:
        row = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Product not found.")
        if payload.size_prices is not None:
            conn.execute("""UPDATE products SET name=?,category=?,description=?,price=?,image=?,available=?,featured=?,sizes_json=?,updated_at=? WHERE id=?""", (
                payload.name, payload.category, payload.description.strip(), payload.price, payload.image.strip(), int(payload.available), int(payload.featured), json.dumps(payload.size_prices), timestamp, product_id,
            ))
        else:
            conn.execute("""UPDATE products SET name=?,category=?,description=?,price=?,image=?,available=?,featured=?,updated_at=? WHERE id=?""", (
                payload.name, payload.category, payload.description.strip(), payload.price, payload.image.strip(), int(payload.available), int(payload.featured), timestamp, product_id,
            ))
        updated = dict(conn.execute("SELECT id,name,category,description,price,image,available,featured,sizes_json,created_at,updated_at FROM products WHERE id=?", (product_id,)).fetchone())
        updated["available"] = bool(updated["available"])
        updated["featured"] = bool(updated["featured"])
        updated["sizes"] = size_variants_for(updated)
        updated["size_prices"] = {size["id"]: size["price"] for size in updated["sizes"]}
        return {"message": "Product updated.", "product": updated}


@app.delete("/api/admin/products/{product_id}")
def archive_product(product_id: str, _: str = Depends(staff_guard)) -> dict[str, Any]:
    with db_connection() as conn:
        row = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Product not found.")
        conn.execute("UPDATE products SET available=0,updated_at=? WHERE id=?", (now_iso(), product_id))
        return {"message": "Product archived. Historical order lines remain unchanged."}


@app.get("/api/admin/orders")
def admin_orders(_: str = Depends(staff_guard), status: str = "all") -> dict[str, Any]:
    with db_connection() as conn:
        if status == "pending-payment":
            rows = conn.execute("SELECT * FROM orders WHERE payment_status='Awaiting Verification' ORDER BY created_at DESC LIMIT 200").fetchall()
        elif status == "open":
            rows = conn.execute("SELECT * FROM orders WHERE order_status NOT IN ('Completed','Cancelled') ORDER BY created_at DESC LIMIT 200").fetchall()
        else:
            rows = conn.execute("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").fetchall()
        orders = []
        for row in rows:
            item = public_order(conn, row, include_events=True)
            item["transaction_reference"] = row["transaction_reference"]
            item["payment_decision_reason"] = row["payment_decision_reason"]
            item["receipt_filename"] = row["receipt_filename"]
            item["cash_collected_by"] = row["cash_collected_by"]
            edit_info = conn.execute("SELECT COUNT(*) edits, MAX(created_at) last_edit FROM order_edit_history WHERE order_id=?", (row["id"],)).fetchone()
            item["customer_edit_count"] = int(edit_info["edits"] or 0)
            item["customer_last_edited_at"] = edit_info["last_edit"]
            orders.append(item)
        metrics = conn.execute("""SELECT COUNT(*) total_orders,
            COALESCE(SUM(CASE WHEN payment_status='Paid' THEN total ELSE 0 END),0) paid_sales,
            COALESCE(SUM(CASE WHEN order_status NOT IN ('Completed','Cancelled') THEN 1 ELSE 0 END),0) open_orders,
            COALESCE(SUM(CASE WHEN payment_status='Awaiting Verification' THEN 1 ELSE 0 END),0) pending_payments
            FROM orders""").fetchone()
        popular = conn.execute("""SELECT product_name,SUM(quantity) quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id
            WHERE o.order_status != 'Cancelled' GROUP BY product_id,product_name ORDER BY quantity DESC LIMIT 5""").fetchall()
        return {"orders": orders, "metrics": dict(metrics), "popular_products": [dict(p) for p in popular]}


@app.post("/api/admin/orders/{public_id}/payment-decision")
def admin_payment_decision(public_id: str, payload: PaymentDecision, actor: str = Depends(staff_guard)) -> dict[str, Any]:
    with db_connection() as conn:
        row = get_order_by_public_id(conn, public_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Order not found.")
        if row["order_status"] == "Cancelled":
            raise HTTPException(status_code=409, detail="This order is cancelled. Do not approve a payment claim; contact the customer and handle any received funds manually.")
        if row["payment_method"] not in {"gcash", "maya"}:
            raise HTTPException(status_code=400, detail="Manual e-wallet verification only applies to GCash and Maya.")
        if row["payment_status"] != "Awaiting Verification":
            raise HTTPException(status_code=409, detail="This order has no payment claim awaiting verification.")
        if payload.decision == "approve":
            new_status = "Paid"
            reason = payload.reason.strip() or "Transfer verified in the business account."
        else:
            if len(payload.reason.strip()) < 3:
                raise HTTPException(status_code=422, detail="Provide a reason for rejecting this payment claim.")
            new_status = "Rejected"
            reason = payload.reason.strip()
        conn.execute("UPDATE orders SET payment_status=?,payment_decision_reason=?,verified_by='admin',verified_at=?,updated_at=? WHERE id=? AND payment_status='Awaiting Verification'", (new_status, reason, now_iso(), next_version_stamp(row["updated_at"]), row["id"]))
        add_event(conn, row["id"], f"Payment {new_status.lower()}", reason, "admin")
        updated = conn.execute("SELECT * FROM orders WHERE id=?", (row["id"],)).fetchone()
        return {"message": f"Payment marked {new_status.lower()}.", "order": public_order(conn, updated)}


@app.post("/api/admin/orders/{public_id}/cash-collected")
def admin_cash_collected(public_id: str, actor: str = Depends(staff_guard)) -> dict[str, Any]:
    with db_connection() as conn:
        row = get_order_by_public_id(conn, public_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Order not found.")
        if row["payment_method"] != "cash":
            raise HTTPException(status_code=400, detail="Cash collection applies only to cash orders.")
        if row["payment_status"] == "Paid":
            raise HTTPException(status_code=409, detail="Cash was already recorded as collected.")
        if row["order_status"] == "Cancelled":
            raise HTTPException(status_code=409, detail="Cancelled orders cannot be marked as paid.")
        conn.execute("UPDATE orders SET payment_status='Paid',cash_collected_by='admin',cash_collected_at=?,updated_at=? WHERE id=?", (now_iso(), next_version_stamp(row["updated_at"]), row["id"]))
        add_event(conn, row["id"], "Cash collected", "Staff confirmed receiving the full cash amount", "admin")
        updated = conn.execute("SELECT * FROM orders WHERE id=?", (row["id"],)).fetchone()
        return {"message": "Cash collection recorded.", "order": public_order(conn, updated)}


VALID_TRANSITIONS = {
    "Pending Confirmation": {"Confirmed", "Cancelled"},
    "Confirmed": {"Preparing", "Cancelled"},
    "Preparing": {"Ready for Pickup", "Out for Delivery", "Cancelled"},
    "Ready for Pickup": {"Completed"},
    "Out for Delivery": {"Completed"},
    "Completed": set(),
    "Cancelled": set(),
}


@app.patch("/api/admin/orders/{public_id}/status")
def admin_update_status(public_id: str, payload: StatusUpdate, actor: str = Depends(staff_guard)) -> dict[str, Any]:
    with db_connection() as conn:
        row = get_order_by_public_id(conn, public_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Order not found.")
        current = row["order_status"]
        if payload.status == "Cancelled" and row["payment_status"] in {"Paid", "Awaiting Verification"}:
            raise HTTPException(status_code=409, detail="Resolve the payment first. Paid or submitted e-wallet payments cannot be cancelled in the dashboard without a documented manual refund workflow.")
        if payload.status != current and payload.status not in VALID_TRANSITIONS.get(current, set()):
            raise HTTPException(status_code=409, detail=f"Status cannot move from {current} to {payload.status}.")
        if payload.status == "Completed" and row["payment_status"] != "Paid":
            raise HTTPException(status_code=409, detail="An order cannot be completed until payment is marked paid.")
        conn.execute("UPDATE orders SET order_status=?,updated_at=? WHERE id=?", (payload.status, next_version_stamp(row["updated_at"]), row["id"]))
        add_event(conn, row["id"], "Order status changed", f"{current} → {payload.status}", "admin")
        updated = conn.execute("SELECT * FROM orders WHERE id=?", (row["id"],)).fetchone()
        return {"message": "Order status updated.", "order": public_order(conn, updated)}


@app.get("/api/admin/receipts/{filename}")
def admin_receipt(filename: str, _: str = Depends(staff_guard)) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{32}\.(jpg|png|webp)", filename):
        raise HTTPException(status_code=404, detail="Receipt not found.")
    path = UPLOAD_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Receipt not found.")
    return FileResponse(path, media_type={"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[path.suffix[1:]], filename="payment-receipt")


@app.get("/api/analytics")
def analytics(_: str = Depends(admin_guard)) -> dict[str, Any]:
    with db_connection() as conn:
        totals = conn.execute("""SELECT COUNT(*) total_orders,
        COALESCE(SUM(CASE WHEN payment_status='Paid' AND order_status!='Cancelled' THEN total ELSE 0 END),0) paid_sales,
        COALESCE(AVG(CASE WHEN payment_status='Paid' AND order_status!='Cancelled' THEN total END),0) average_paid_order,
        COALESCE(SUM(CASE WHEN payment_method='cash' AND order_status!='Cancelled' THEN 1 ELSE 0 END),0) cash_orders,
        COALESCE(SUM(CASE WHEN payment_method='gcash' AND order_status!='Cancelled' THEN 1 ELSE 0 END),0) gcash_orders,
        COALESCE(SUM(CASE WHEN payment_method='maya' AND order_status!='Cancelled' THEN 1 ELSE 0 END),0) maya_orders,
        COALESCE(SUM(CASE WHEN order_status='Pending Confirmation' THEN 1 ELSE 0 END),0) pending_orders,
        COALESCE(SUM(CASE WHEN order_status='Completed' THEN 1 ELSE 0 END),0) completed_orders,
        COALESCE(SUM(CASE WHEN order_status='Cancelled' THEN 1 ELSE 0 END),0) cancelled_orders
        FROM orders""").fetchone()
        by_status = conn.execute("SELECT order_status,COUNT(*) count FROM orders GROUP BY order_status ORDER BY count DESC").fetchall()
        products = conn.execute("""SELECT product_name,SUM(quantity) quantity,SUM(line_total) sales FROM order_items oi
        JOIN orders o ON o.id=oi.order_id WHERE o.order_status!='Cancelled' GROUP BY product_id,product_name ORDER BY quantity DESC, sales DESC LIMIT 10""").fetchall()
        trend = conn.execute("""SELECT date(created_at) date,
            COUNT(*) orders,
            COALESCE(SUM(CASE WHEN payment_status='Paid' AND order_status!='Cancelled' THEN total ELSE 0 END),0) revenue
            FROM orders WHERE date(created_at) >= date('now','-29 days')
            GROUP BY date(created_at) ORDER BY date(created_at)""").fetchall()
        return {"summary": dict(totals), "orders_by_status": [dict(r) for r in by_status], "top_products": [dict(r) for r in products], "sales_trend": [dict(r) for r in trend]}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), reload=os.getenv("RELOAD", "false").lower() == "true")
