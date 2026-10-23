import os
import tempfile
from pathlib import Path

TEST_DIR = Path(tempfile.mkdtemp(prefix="burger_haven_test_"))
os.environ["DATABASE_PATH"] = str(TEST_DIR / "test.db")
os.environ["ADMIN_TOKEN"] = "strong-test-admin-token-for-local-tests-0123456789"
os.environ["GCASH_ACCOUNT_NAME"] = "Burger Haven Test"
os.environ["GCASH_NUMBER"] = "09123456789"
os.environ["MAYA_ACCOUNT_NAME"] = "Burger Haven Test"
os.environ["MAYA_NUMBER"] = "09987654321"
os.environ["DELIVERY_FEE_PHP"] = "30"

from fastapi.testclient import TestClient
import app as bh

ADMIN_HEADERS = {"X-Admin-Token": os.environ["ADMIN_TOKEN"]}


def order_payload(method="cash", fulfillment="pickup", key="test-idempotency-key-0000001", token="customer-private-token-01234567890123456789"):
    return {
        "idempotency_key": key,
        "access_token": token,
        "customer_name": "Test Customer",
        "phone": "09123456789",
        "fulfillment_type": fulfillment,
        "address": "123 Sample Street, Cebu City" if fulfillment == "delivery" else "",
        "notes": "Please call on arrival",
        "payment_method": method,
        "items": [{"product_id": "classic-burger", "quantity": 2, "addons": ["extra-cheese"]}],
    }


def test_cash_order_totals_and_collection():
    with TestClient(bh.app) as client:
        response = client.post("/api/orders", json=order_payload())
        assert response.status_code == 201, response.text
        result = response.json()
        order = result["order"]
        assert order["subtotal"] == 280
        assert order["delivery_fee"] == 0
        assert order["total"] == 280
        assert order["payment_status"] == "Unpaid"
        assert order["payment_method"] == "cash"

        tracked = client.get(f"/api/orders/{order['public_id']}", headers={"X-Order-Token": result["access_token"]})
        assert tracked.status_code == 200
        assert tracked.json()["order"]["payment_status"] == "Unpaid"

        collected = client.post(f"/api/admin/orders/{order['public_id']}/cash-collected", headers=ADMIN_HEADERS)
        assert collected.status_code == 200, collected.text
        assert collected.json()["order"]["payment_status"] == "Paid"
        assert client.post(f"/api/admin/orders/{order['public_id']}/cash-collected", headers=ADMIN_HEADERS).status_code == 409


def test_manual_gcash_claim_requires_admin_verification():
    with TestClient(bh.app) as client:
        create = client.post("/api/orders", json=order_payload(
            method="gcash", fulfillment="delivery", key="test-idempotency-key-gcash-001", token="gcash-customer-token-01234567890123456789"
        ))
        assert create.status_code == 201, create.text
        order = create.json()["order"]
        token = create.json()["access_token"]

        claim = client.post(
            f"/api/orders/{order['public_id']}/payment-claim",
            headers={"X-Order-Token": token},
            data={"transaction_reference": "GCASH-TEST-TRANSACTION-001"},
        )
        assert claim.status_code == 200, claim.text
        assert claim.json()["order"]["payment_status"] == "Awaiting Verification"

        pending = client.get("/api/admin/orders?status=pending-payment", headers=ADMIN_HEADERS)
        assert pending.status_code == 200
        assert any(item["public_id"] == order["public_id"] for item in pending.json()["orders"])

        approved = client.post(
            f"/api/admin/orders/{order['public_id']}/payment-decision",
            headers=ADMIN_HEADERS,
            json={"decision": "approve", "reason": "Verified in the test merchant account."},
        )
        assert approved.status_code == 200, approved.text
        assert approved.json()["order"]["payment_status"] == "Paid"


def test_idempotency_returns_same_order():
    with TestClient(bh.app) as client:
        payload = order_payload(key="same-idempotency-key-test-00001", token="same-customer-token-012345678901234567890")
        first = client.post("/api/orders", json=payload)
        second = client.post("/api/orders", json=payload)
        assert first.status_code == 201, first.text
        assert second.status_code == 201, second.text
        assert first.json()["order"]["public_id"] == second.json()["order"]["public_id"]
        assert second.json()["replayed"] is True


def test_order_access_requires_private_token():
    with TestClient(bh.app) as client:
        created = client.post("/api/orders", json=order_payload(key="test-idempotency-key-private-001", token="real-private-token-012345678901234567890"))
        public_id = created.json()["order"]["public_id"]
        assert client.get(f"/api/orders/{public_id}").status_code == 404
        assert client.get(f"/api/orders/{public_id}", headers={"X-Order-Token": "incorrect-private-token-000000000000000000"}).status_code == 404


def test_receipt_upload_is_private_and_visible_to_staff():
    # A valid one-pixel PNG (signature + valid PNG structure).
    import base64
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/uXcAAAAASUVORK5CYII=")
    with TestClient(bh.app) as client:
        created = client.post("/api/orders", json=order_payload(
            method="maya", fulfillment="pickup", key="test-idempotency-key-maya-0001", token="maya-customer-token-012345678901234567890"
        ))
        assert created.status_code == 201, created.text
        order = created.json()["order"]
        token = created.json()["access_token"]
        claim = client.post(
            f"/api/orders/{order['public_id']}/payment-claim",
            headers={"X-Order-Token": token},
            data={"transaction_reference": "MAYA-TEST-TRANSACTION-001"},
            files={"receipt": ("receipt.png", png, "image/png")},
        )
        assert claim.status_code == 200, claim.text
        assert claim.json()["order"]["has_receipt"] is True
        listed = client.get("/api/admin/orders?status=pending-payment", headers=ADMIN_HEADERS)
        matching = next(item for item in listed.json()["orders"] if item["public_id"] == order["public_id"])
        assert matching["receipt_filename"].endswith(".png")
        assert client.get(f"/api/admin/receipts/{matching['receipt_filename']}", headers=ADMIN_HEADERS).status_code == 200
        assert client.get(f"/api/admin/receipts/{matching['receipt_filename']}").status_code == 401


def test_staff_endpoints_reject_invalid_token():
    with TestClient(bh.app) as client:
        assert client.get("/api/admin/orders", headers={"X-Admin-Token": "wrong-token"}).status_code == 401


def test_server_rejects_gcash_when_business_account_is_not_configured(monkeypatch):
    monkeypatch.setenv("GCASH_ACCOUNT_NAME", "replace-with-official-business-account-name")
    monkeypatch.setenv("GCASH_NUMBER", "replace-with-official-business-number")
    with TestClient(bh.app) as client:
        response = client.post("/api/orders", json=order_payload(
            method="gcash", key="test-idempotency-key-missingacct-1", token="customer-token-missing-account-0123456789"
        ))
        assert response.status_code == 400
        assert "not configured" in response.json()["error"]


def test_admin_can_create_update_and_archive_menu_product():
    with TestClient(bh.app) as client:
        payload = {
            "name": "Test Chicken Burger",
            "category": "Burgers",
            "description": "Test product description",
            "price": 135,
            "image": "/static/food-fallback.svg",
            "available": True,
            "featured": False,
        }
        created = client.post("/api/admin/products", headers=ADMIN_HEADERS, json=payload)
        assert created.status_code == 201, created.text
        product = created.json()["product"]
        assert product["id"] == "test-chicken-burger"
        assert product["price"] == 135
        assert any(p["id"] == product["id"] for p in client.get("/api/products").json()["products"])

        updated = {**payload, "price": 145, "available": True}
        response = client.put(f"/api/admin/products/{product['id']}", headers=ADMIN_HEADERS, json=updated)
        assert response.status_code == 200, response.text
        assert response.json()["product"]["price"] == 145

        archived = client.delete(f"/api/admin/products/{product['id']}", headers=ADMIN_HEADERS)
        assert archived.status_code == 200
        assert not any(p["id"] == product["id"] for p in client.get("/api/products").json()["products"])
        assert any(p["id"] == product["id"] and p["available"] is False for p in client.get("/api/admin/products", headers=ADMIN_HEADERS).json()["products"])


def test_new_product_prices_are_authoritative_for_checkout():
    with TestClient(bh.app) as client:
        product = client.post("/api/admin/products", headers=ADMIN_HEADERS, json={
            "name": "Price Test Burger", "category": "Burgers", "description": "For test only",
            "price": 77, "image": "/static/food-fallback.svg", "available": True, "featured": False,
        })
        assert product.status_code == 201, product.text
        item_id = product.json()["product"]["id"]
        payload = order_payload(key="test-idempotency-new-product-price-01", token="new-product-price-token-012345678901234567890")
        payload["items"] = [{"product_id": item_id, "quantity": 3, "addons": ["bacon"]}]
        created = client.post("/api/orders", json=payload)
        assert created.status_code == 201, created.text
        assert created.json()["order"]["subtotal"] == (77 + 30) * 3


def test_customer_staff_and_analytics_pages_load():
    with TestClient(bh.app) as client:
        for path in ("/", "/admin", "/analytics", "/static/style.css", "/static/app.js", "/static/admin.js", "/static/logo.svg"):
            response = client.get(path)
            assert response.status_code == 200, f"{path}: {response.status_code}"
        products = client.get("/api/products")
        assert products.status_code == 200
        assert len(products.json()["products"]) > 0
        assert client.get("/api/health").json()["status"] == "ok"


def test_prevent_cancellation_when_money_is_paid_or_e_wallet_claim_is_pending():
    with TestClient(bh.app) as client:
        cash = client.post("/api/orders", json=order_payload(
            key="test-idempotency-cancel-paid-0001", token="cancel-paid-customer-token-01234567890"
        ))
        assert cash.status_code == 201, cash.text
        cash_order = cash.json()["order"]["public_id"]
        assert client.post(f"/api/admin/orders/{cash_order}/cash-collected", headers=ADMIN_HEADERS).status_code == 200
        cancelled_paid = client.patch(f"/api/admin/orders/{cash_order}/status", headers=ADMIN_HEADERS, json={"status": "Cancelled"})
        assert cancelled_paid.status_code == 409

        ewallet = client.post("/api/orders", json=order_payload(
            method="maya", key="test-idempotency-cancel-claim-001", token="cancel-claim-customer-token-01234567890123456789"
        ))
        assert ewallet.status_code == 201, ewallet.text
        order = ewallet.json()["order"]
        token = ewallet.json()["access_token"]
        claim = client.post(f"/api/orders/{order['public_id']}/payment-claim", headers={"X-Order-Token": token}, data={"transaction_reference": "MAYA-CANCEL-TEST-001"})
        assert claim.status_code == 200, claim.text
        cancelled_pending = client.patch(f"/api/admin/orders/{order['public_id']}/status", headers=ADMIN_HEADERS, json={"status": "Cancelled"})
        assert cancelled_pending.status_code == 409


def test_soft_drink_brand_and_size_set_authoritative_checkout_price():
    with TestClient(bh.app) as client:
        catalog = client.get("/api/products").json()
        assert catalog["drink_variants"]["brands"] == ["Sprint", "Sprite", "Royal", "Coke", "Pepsi"]
        assert [size["price"] for size in catalog["drink_variants"]["sizes"]] == [25, 35, 50]
        payload = order_payload(
            key="test-idempotency-drink-variant-0001",
            token="drink-variant-customer-token-012345678901234567890",
        )
        payload["items"] = [{
            "product_id": "soft-drink",
            "quantity": 2,
            "addons": [],
            "options": {"drink_brand": "Coke", "drink_size": "large"},
        }]
        response = client.post("/api/orders", json=payload)
        assert response.status_code == 201, response.text
        order = response.json()["order"]
        assert order["subtotal"] == 100
        assert order["items"][0]["unit_price"] == 50
        assert "Coke" in order["items"][0]["product_name"]
        assert "Large (500 ml)" in order["items"][0]["product_name"]


def test_soft_drink_requires_valid_brand_and_size():
    with TestClient(bh.app) as client:
        payload = order_payload(
            key="test-idempotency-drink-invalid-0001",
            token="drink-invalid-customer-token-012345678901234567890",
        )
        payload["items"] = [{"product_id": "soft-drink", "quantity": 1, "addons": [], "options": {"drink_brand": "FakeCola", "drink_size": "large"}}]
        bad_brand = client.post("/api/orders", json=payload)
        assert bad_brand.status_code == 422, bad_brand.text

        payload["idempotency_key"] = "test-idempotency-drink-missing-0001"
        payload["access_token"] = "drink-missing-customer-token-012345678901234567890"
        payload["items"][0]["options"] = {"drink_brand": "Royal"}
        missing_size = client.post("/api/orders", json=payload)
        assert missing_size.status_code == 422, missing_size.text


def test_local_page_aliases_and_navigation_assets_load():
    with TestClient(bh.app) as client:
        for path in ("/admin.html", "/analytics.html", "/static/navigation.js", "/static/analytics.py"):
            response = client.get(path)
            assert response.status_code == 200, f"{path}: {response.status_code}"


def test_burger_combo_stores_soft_drink_choice_and_applies_size_difference():
    with TestClient(bh.app) as client:
        payload = order_payload(
            key="test-idempotency-combo-drink-0001",
            token="combo-drink-customer-token-012345678901234567890",
        )
        payload["items"] = [{
            "product_id": "burger-combo",
            "quantity": 1,
            "addons": [],
            "options": {"drink_brand": "Royal", "drink_size": "large"},
        }]
        response = client.post("/api/orders", json=payload)
        assert response.status_code == 201, response.text
        order = response.json()["order"]
        # Regular (330 ml) is included in the ₱175 combo price; Large adds ₱15.
        assert order["subtotal"] == 190
        assert order["items"][0]["product_name"] == "Burger Combo — Royal · Large (500 ml)"


def test_customer_register_login_order_history_and_logout():
    with TestClient(bh.app) as client:
        payload = {
            "full_name": "Account Test Customer",
            "email": "account-test@example.com",
            "phone": "09123456789",
            "password": "GoodPassword123",
            "confirm_password": "GoodPassword123",
            "accept_terms": True,
        }
        registered = client.post("/api/auth/register", json=payload)
        assert registered.status_code == 201, registered.text
        user = registered.json()["user"]
        token = registered.json()["token"]
        assert client.get("/api/auth/me", headers={"X-Customer-Token": token}).json()["user"]["id"] == user["id"]
        assert client.post("/api/auth/register", json=payload).status_code == 409
        bad_login = client.post("/api/auth/login", json={"email": payload["email"], "password": "WrongPassword123"})
        assert bad_login.status_code == 401
        good_login = client.post("/api/auth/login", json={"email": payload["email"], "password": payload["password"]})
        assert good_login.status_code == 200, good_login.text
        login_token = good_login.json()["token"]
        assert good_login.json()["user"]["email"] == payload["email"]

        order = order_payload(key="auth-history-order-key-00000001", token="auth-history-private-token-01234567890123456789")
        order["items"] = [{"product_id": "classic-burger", "quantity": 1, "addons": [], "options": {"product_size": "medium"}}]
        placed = client.post("/api/orders", json=order, headers={"X-Customer-Token": login_token})
        assert placed.status_code == 201, placed.text
        assert placed.json()["order"]["items"][0]["unit_price"] == 130
        history = client.get("/api/auth/orders", headers={"X-Customer-Token": token})
        assert history.status_code == 200
        assert history.json()["orders"][0]["public_id"] == placed.json()["order"]["public_id"]
        assert client.post("/api/auth/logout", headers={"X-Customer-Token": login_token}).status_code == 200
        assert client.get("/api/auth/me", headers={"X-Customer-Token": login_token}).status_code == 401
        # The original registration session is separate from the login session.
        assert client.post("/api/auth/logout", headers={"X-Customer-Token": token}).status_code == 200


def test_expanded_catalog_and_product_size_prices_are_server_authoritative():
    with TestClient(bh.app) as client:
        response = client.get("/api/products")
        assert response.status_code == 200
        menu = response.json()
        ids = {item["id"] for item in menu["products"]}
        assert {"beef-burger-b1t1", "cheeseburger-b1t1", "cheesy-hotdog-b1t1", "tater-tots", "bottled-water", "lipton-iced-tea"}.issubset(ids)
        onion_rings = next(item for item in menu["products"] if item["id"] == "onion-rings")
        assert [size["price"] for size in onion_rings["sizes"]] == [45, 60, 80, 100]
        payload = order_payload(key="size-price-order-key-00000001", token="size-price-private-token-01234567890123456789")
        payload["items"] = [{"product_id": "onion-rings", "quantity": 2, "addons": [], "options": {"product_size": "xl"}}]
        placed = client.post("/api/orders", json=payload)
        assert placed.status_code == 201, placed.text
        assert placed.json()["order"]["subtotal"] == 200
        assert placed.json()["order"]["items"][0]["options"]["product_size"] == "xl"


def test_admin_can_configure_size_variant_prices():
    with TestClient(bh.app) as client:
        payload = {
            "name": "Variant Configuration Test",
            "category": "Sides",
            "description": "Test product",
            "price": 60,
            "image": "/static/food-fallback.svg",
            "available": True,
            "featured": False,
            "size_prices": {"small": 40, "medium": 60, "large": 80, "xl": 100},
        }
        created = client.post("/api/admin/products", headers=ADMIN_HEADERS, json=payload)
        assert created.status_code == 201, created.text
        product_id = created.json()["product"]["id"]
        product = next(p for p in client.get("/api/products").json()["products"] if p["id"] == product_id)
        assert [variant["price"] for variant in product["sizes"]] == [40, 60, 80, 100]


def test_extended_drink_brand_xl_size_and_b1t1_promotion_checkout():
    with TestClient(bh.app) as client:
        payload = order_payload(
            key="extended-drink-xl-order-key-001",
            token="extended-drink-private-token-01234567890123456789",
        )
        payload["items"] = [{
            "product_id": "soft-drink", "quantity": 2, "addons": [],
            "options": {"drink_brand": "Mountain Dew", "drink_size": "xl"},
        }]
        drink = client.post("/api/orders", json=payload)
        assert drink.status_code == 201, drink.text
        assert drink.json()["order"]["subtotal"] == 120
        assert drink.json()["order"]["items"][0]["unit_price"] == 60
        assert "Mountain Dew" in drink.json()["order"]["items"][0]["product_name"]
        assert "XL (700 ml)" in drink.json()["order"]["items"][0]["product_name"]

        b1t1 = order_payload(
            key="b1t1-promotion-order-key-0001",
            token="b1t1-promotion-private-token-012345678901234567890",
        )
        b1t1["items"] = [{"product_id": "beef-burger-b1t1", "quantity": 2, "addons": []}]
        promo = client.post("/api/orders", json=b1t1)
        assert promo.status_code == 201, promo.text
        assert promo.json()["order"]["subtotal"] == 88
        assert promo.json()["order"]["items"][0]["quantity"] == 2
        assert promo.json()["order"]["items"][0]["product_name"].endswith("B1T1")
        assert client.get("/api/products").json()["drink_variants"]["additional_brands"] == ["7-Up", "Mirinda", "Mountain Dew"]


def _register_for_order_edit(client, email):
    payload = {
        "full_name": "Order Edit Customer",
        "email": email,
        "phone": "09123456789",
        "password": "SecurePassword123",
        "confirm_password": "SecurePassword123",
        "accept_terms": True,
    }
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["token"]


def test_customer_can_edit_owned_order_without_creating_duplicate_and_cannot_edit_others():
    with TestClient(bh.app) as client:
        owner_token = _register_for_order_edit(client, "order-editor@example.com")
        created = client.post(
            "/api/orders",
            headers={"X-Customer-Token": owner_token},
            json=order_payload(key="test-order-edit-key-0000000001", token="test-order-edit-access-token-0123456789"),
        )
        assert created.status_code == 201, created.text
        original = created.json()["order"]
        assert original["can_edit"] is True
        original_id = original["public_id"]

        stranger_token = _register_for_order_edit(client, "stranger-editor@example.com")
        denied = client.put(
            f"/api/auth/orders/{original_id}",
            headers={"X-Customer-Token": stranger_token},
            json={"expected_updated_at": original["updated_at"], "items": [{"product_id": "classic-burger", "quantity": 1}]},
        )
        assert denied.status_code == 404

        edited = client.put(
            f"/api/auth/orders/{original_id}",
            headers={"X-Customer-Token": owner_token},
            json={"expected_updated_at": original["updated_at"], "items": [{"product_id": "classic-burger", "quantity": 3, "addons": [], "options": {}}]},
        )
        assert edited.status_code == 200, edited.text
        updated = edited.json()["order"]
        assert updated["public_id"] == original_id
        assert updated["subtotal"] == 360
        assert updated["total"] == 360
        assert updated["payment_status"] == "Unpaid"
        assert updated["items"][0]["quantity"] == 3

        history = client.get("/api/auth/orders", headers={"X-Customer-Token": owner_token})
        assert history.status_code == 200
        assert len(history.json()["orders"]) == 1
        assert history.json()["orders"][0]["public_id"] == original_id
        with bh.db_connection() as conn:
            audit = conn.execute("SELECT old_total,new_total FROM order_edit_history WHERE order_id=(SELECT id FROM orders WHERE public_id=?)", (original_id,)).fetchone()
            assert tuple(audit) == (280, 360)


def test_staff_token_can_operate_but_cannot_access_admin_analytics(monkeypatch):
    monkeypatch.setattr(bh, "STAFF_TOKEN", "strong-test-staff-token-only-for-operations")
    with TestClient(bh.app) as client:
        staff_headers = {"X-Admin-Token": "strong-test-staff-token-only-for-operations"}
        assert client.get("/api/admin/orders", headers=staff_headers).status_code == 200
        assert client.get("/api/admin/products", headers=staff_headers).status_code == 200
        assert client.get("/api/analytics", headers=staff_headers).status_code == 401
        admin_analytics = client.get("/api/analytics", headers=ADMIN_HEADERS)
        assert admin_analytics.status_code == 200
        assert "sales_trend" in admin_analytics.json()
        assert "pending_orders" in admin_analytics.json()["summary"]


def test_calculation_buttons_removed_and_analytics_is_database_backed():
    with TestClient(bh.app) as client:
        storefront_response = client.get("/")
        storefront = storefront_response.text
        analytics_page = client.get("/analytics").text
        assert "no-store" in storefront_response.headers.get("cache-control", "")
        assert "Staff Dashboard" not in storefront
        assert "Analytics" not in storefront
        assert "My Orders / Order History" in storefront
        assert 'id="load-my-orders"' in storefront
        assert "application-version" in storefront
        assert "Calculate Total" not in storefront
        assert "Calculate Scenario" not in analytics_page
        assert "Admin Analytics" in analytics_page
        assert client.get("/static/analytics.js").status_code == 200
        app_script = client.get("/static/app.js").text
        assert "function updateOrderEditLiveTotals" in app_script
        assert 'data-action="edit-order"' in app_script


# ---------------------------------------------------------------------------
# Role-based access: customer / staff / admin accounts (enforced server-side)
# ---------------------------------------------------------------------------

def _account(client, email, role=None):
    """Register a public account (always a customer), then optionally grant a role the way
    manage_users.py does: directly in the database from the server."""
    payload = {"full_name": "Role Test User", "email": email, "phone": "09123456789",
               "password": "GoodPassword123", "confirm_password": "GoodPassword123", "accept_terms": True}
    registered = client.post("/api/auth/register", json=payload)
    assert registered.status_code == 201, registered.text
    assert registered.json()["user"]["role"] == "customer"
    if role:
        with bh.db_connection() as conn:
            conn.execute("UPDATE users SET role=? WHERE email=? COLLATE NOCASE", (role, email))
    return {"X-Customer-Token": registered.json()["token"]}


def test_registration_cannot_grant_a_role_and_defaults_to_customer():
    with TestClient(bh.app) as client:
        response = client.post("/api/auth/register", json={
            "full_name": "Sneaky Customer", "email": "sneaky-role@example.com", "phone": "09123456789",
            "password": "GoodPassword123", "confirm_password": "GoodPassword123", "accept_terms": True, "role": "admin",
        })
        assert response.status_code == 201, response.text
        assert response.json()["user"]["role"] == "customer"
        headers = {"X-Customer-Token": response.json()["token"]}
        assert client.get("/api/auth/me", headers=headers).json()["user"]["role"] == "customer"
        assert client.get("/api/admin/orders", headers=headers).status_code == 403
        assert client.get("/api/analytics", headers=headers).status_code == 403


def test_customer_account_is_denied_every_staff_and_analytics_endpoint():
    with TestClient(bh.app) as client:
        customer = _account(client, "role-customer@example.com")
        for method, path in (
            ("get", "/api/admin/access"), ("get", "/api/admin/orders"), ("get", "/api/admin/products"),
            ("get", "/api/analytics"), ("post", "/api/admin/orders/BH-NOPE/cash-collected"),
            ("delete", "/api/admin/products/classic-burger"),
        ):
            response = getattr(client, method)(path, headers=customer)
            assert response.status_code == 403, f"{method.upper()} {path}: {response.status_code}"
        # Customer features still work for the same session.
        assert client.get("/api/auth/me", headers=customer).status_code == 200
        assert client.get("/api/auth/orders", headers=customer).status_code == 200


def test_staff_account_can_operate_but_not_open_analytics():
    with TestClient(bh.app) as client:
        staff = _account(client, "role-staff@example.com", "staff")
        assert client.get("/api/admin/orders", headers=staff).status_code == 200
        assert client.get("/api/admin/products", headers=staff).status_code == 200
        access = client.get("/api/admin/access", headers=staff).json()
        assert access["role"] == "staff" and access["permissions"]["analytics"] is False
        assert client.get("/api/analytics", headers=staff).status_code == 403


def test_admin_account_can_use_staff_dashboard_and_analytics():
    with TestClient(bh.app) as client:
        admin = _account(client, "role-admin@example.com", "admin")
        assert client.get("/api/admin/orders", headers=admin).status_code == 200
        assert client.get("/api/admin/access", headers=admin).json()["permissions"]["analytics"] is True
        assert "summary" in client.get("/api/analytics", headers=admin).json()


def test_role_changes_apply_immediately_and_expired_sessions_are_rejected():
    with TestClient(bh.app) as client:
        headers = _account(client, "role-demotion@example.com", "staff")
        assert client.get("/api/admin/orders", headers=headers).status_code == 200
        with bh.db_connection() as conn:
            conn.execute("UPDATE users SET role='customer' WHERE email='role-demotion@example.com'")
        assert client.get("/api/admin/orders", headers=headers).status_code == 403
        assert client.get("/api/admin/orders", headers={"X-Customer-Token": "x" * 48}).status_code == 401


def test_non_ascii_token_header_is_rejected_cleanly_not_with_a_server_error():
    with TestClient(bh.app) as client:
        response = client.get("/api/admin/orders", headers={"X-Admin-Token": "caf\u00e9".encode("latin-1")})
        assert response.status_code == 401


def test_staff_endpoint_actions_work_with_a_staff_account():
    with TestClient(bh.app) as client:
        staff = _account(client, "role-staff-actions@example.com", "staff")
        created = client.post("/api/orders", json=order_payload(key="role-staff-action-key-000000001", token="role-staff-action-token-0123456789012345"))
        assert created.status_code == 201, created.text
        public_id = created.json()["order"]["public_id"]
        collected = client.post(f"/api/admin/orders/{public_id}/cash-collected", headers=staff)
        assert collected.status_code == 200, collected.text
        assert collected.json()["order"]["payment_status"] == "Paid"


def test_admin_order_list_flags_orders_the_customer_edited():
    with TestClient(bh.app) as client:
        owner = _account(client, "role-edit-flag@example.com")
        created = client.post("/api/orders", headers=owner, json=order_payload(key="role-edit-flag-key-0000000001", token="role-edit-flag-access-token-0123456789"))
        assert created.status_code == 201, created.text
        original = created.json()["order"]
        listing = client.get("/api/admin/orders", headers=ADMIN_HEADERS).json()["orders"]
        assert next(o for o in listing if o["public_id"] == original["public_id"])["customer_edit_count"] == 0
        edited = client.put(f"/api/auth/orders/{original['public_id']}", headers=owner, json={
            "expected_updated_at": original["updated_at"],
            "items": [{"product_id": "classic-burger", "quantity": 1, "addons": [], "options": {}}]})
        assert edited.status_code == 200, edited.text
        listing = client.get("/api/admin/orders", headers=ADMIN_HEADERS).json()["orders"]
        flagged = next(o for o in listing if o["public_id"] == original["public_id"])
        assert flagged["customer_edit_count"] == 1 and flagged["customer_last_edited_at"]


def test_stale_editor_check_catches_a_staff_change_in_the_same_second():
    with TestClient(bh.app) as client:
        owner = _account(client, "role-stale-edit@example.com")
        created = client.post("/api/orders", headers=owner, json=order_payload(key="role-stale-edit-key-000000001", token="role-stale-edit-access-token-012345678"))
        assert created.status_code == 201, created.text
        original = created.json()["order"]
        # Staff confirm the order immediately (same wall-clock second as creation).
        confirmed = client.patch(f"/api/admin/orders/{original['public_id']}/status", headers=ADMIN_HEADERS, json={"status": "Confirmed"})
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["order"]["updated_at"] != original["updated_at"]
        stale = client.put(f"/api/auth/orders/{original['public_id']}", headers=owner, json={
            "expected_updated_at": original["updated_at"],
            "items": [{"product_id": "classic-burger", "quantity": 2, "addons": [], "options": {}}]})
        assert stale.status_code == 409, stale.text


def test_legacy_database_without_role_column_migrates_and_keeps_accounts(tmp_path, monkeypatch):
    import sqlite3
    legacy = tmp_path / "legacy.db"
    conn = sqlite3.connect(legacy)
    conn.executescript("""
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            phone TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO users(full_name,email,phone,password_hash,created_at,updated_at) VALUES('Old User','old@example.com','0912','x','t','t');
    """)
    conn.commit(); conn.close()
    monkeypatch.setattr(bh, "DB_PATH", legacy)
    bh.initialize_database()
    check = sqlite3.connect(legacy)
    assert check.execute("SELECT role FROM users WHERE email='old@example.com'").fetchone()[0] == "customer"
    check.close()
