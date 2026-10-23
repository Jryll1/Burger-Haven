# Burger Haven — Food Ordering Application

A responsive Burger Haven ordering app styled in the original black-and-yellow burger brand direction, with a lightweight FastAPI backend, SQLite storage, customer checkout and order tracking, a staff dashboard, a live-menu order calculator, a promotional video area, and a database-backed administrator analytics dashboard with an automatic hypothetical sales-scenario planner.

**Payment method policy:** Cash, GCash, and Maya do **not** use payment APIs or gateways. Cash is recorded as paid only after staff confirm they physically received the money. GCash and Maya use manual customer-to-business transfers and a staff verification queue. A screenshot or transaction reference is never treated as payment proof by itself.

## Main features

- Reference-matched storefront: black background, gold/yellow accents, burger-icon branding, oversized BURGER HAVEN hero, four-column product cards, Order Calculator, About section, and promotional video area.
- Responsive storefront with menu categories, search, item customization, extra cheese/bacon, cart, quantity controls, and persistent cart storage.
- Order Calculator uses server-validated product prices and add-ons, supports configurable food sizes, can include fries and customizable soft drinks as separate cart items, and adds the selected meal to the cart. Soft drink options include Sprint, Sprite, Royal, Coke, Pepsi, 7-Up, Mirinda, and Mountain Dew. Cup sizes include Small (250 ml, ₱25), Medium (330 ml, ₱35), Large (500 ml, ₱50), and XL (700 ml, ₱60). These are sample prices configured in `app.py`; checkout validates the selected brand, size, and price on the server.
- Promotional video player area styled to match the visual reference. Add an MP4 named `burger-haven-promo.mp4` in `static/` to enable playback.
- Expanded 37-item starter menu: existing Burger Haven favorites, B1T1 burgers, hotdogs and sausages, ham/bacon/egg sandwiches, expanded sides, bottled water, iced tea, and soft drinks. The starter prices and size prices are editable examples that the restaurant must confirm. Database-backed menu with staff create/edit/archive controls, optional Small/Medium/Large/XL price variants, and server-side price validation; the browser does not determine authoritative totals.
- Delivery/pickup checkout, contact/address validation, delivery fee, and unique order number.
- Cash on delivery and cash on pickup (configurable); unpaid until staff confirm cash collection.
- Manual GCash/Maya instructions, transaction reference submission, optional private receipt image upload (JPG/PNG/WEBP, max 5 MB), staff approval/rejection, and order tracking.
- Secure order lookup using a private customer access token.
- Customer My Orders / Order History editing for eligible pending/confirmed orders, including size/options, quantity changes, automatic totals, ownership restrictions, stale-update protection, and edit audit history.
- Staff dashboard for menu management, order/payment statuses, receipt review, sales summary, and recent order activity. Orders a customer has edited carry an “Edited by customer” badge.
- Administrator-only `/analytics` page with actual database revenue, order counts/statuses, top-selling products, 30-day revenue trend, and a hypothetical scenario planner that recalculates automatically.
- Account roles (`customer` / `staff` / `admin`) enforced by the backend: customers are refused on staff and analytics URLs and APIs, staff cannot open analytics, and admins can use everything. Roles are granted from the server with `manage_users.py`.
- Optional shared tokens still work: `STAFF_TOKEN` for order/menu operations; only `ADMIN_TOKEN` (or an admin account) can open analytics.
- SQLite indexes, safe SQL parameters, unique checkout idempotency keys, private receipt storage, event history, and API health endpoint.


## Design preview (quickest way to see the design)

You can double-click `index.html` after extracting the ZIP. Its CSS, logo, and JavaScript paths are relative, and it will display the full Burger Haven design with a sample menu and working local cart/calculator interactions. A yellow **DESIGN PREVIEW MODE** banner will indicate that it is not connected to the backend; creating real orders, tracking orders, payment submissions, and the staff dashboard require the FastAPI startup steps below. Do not use preview mode to accept real orders.

For the complete application, run FastAPI as described in **Run locally** and visit `http://127.0.0.1:8000`.

## 1. Run locally

Use Python 3.13 (recommended for this package set). Python 3.12 may also work if compatible binary wheels are available.

### Windows (recommended one-click startup)

After extracting the ZIP, double-click `START_BURGER_HAVEN.bat` in the extracted top-level folder. The launcher enters `Burger_Haven_App`, creates or repairs that folder's `.venv` using Python 3.13, installs `requirements.txt`, creates `.env` only if missing, and starts FastAPI from the directory containing `app.py`. Keep the terminal window open while using the site.

### Windows PowerShell (manual)

Open PowerShell **inside the `Burger_Haven_App` folder** (the folder that contains `app.py` and `requirements.txt`), then run:

```powershell
py -3.13 --version
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

If `.venv` already exists and its Python version is not 3.13, close anything using that environment and recreate only the `.venv` folder. Do not run the commands from the outer extracted folder or use its `.venv`: doing so can cause `No module named uvicorn` or `Could not import module "app"` errors.

For a quick local test, keep the example token in `.env`; it is printed in `START_HERE.txt`. Before public deployment, **replace `ADMIN_TOKEN`** with a long random secret. To generate one:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(40))"
```

For GCash and Maya, fill in the business's official account name and account/mobile number. Leave QR image variables blank unless you add a QR image under `static/` and set its URL like `/static/gcash-qr.png`. Do not put personal PINs, OTPs, passwords, or customer credentials in the environment file.

Start the app:

```powershell
python -m uvicorn app:app --reload
```

Open `http://127.0.0.1:8000`. Staff tools are at `http://127.0.0.1:8000/admin` and administrator analytics is at `http://127.0.0.1:8000/analytics`. If you copied `.env.example` without editing its token, use `burger-haven-local-demo-token-change-before-deployment-2026` to unlock the local staff dashboard. If admin access says it is not configured, confirm that `.env` exists in the same folder as `app.py`, check its `ADMIN_TOKEN`, then restart Uvicorn. This token is for local development only; generate a new random token before hosting publicly. The storefront no longer links to staff tools or analytics. The staff dashboard accepts `STAFF_TOKEN` (when configured) or `ADMIN_TOKEN`; administrator analytics requires `ADMIN_TOKEN`. Use the FastAPI-served routes for actual data and authorization checks.

### macOS / Linux

```bash
cd Burger_Haven_App
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
# Keep the sample token for local testing; replace it with a strong random ADMIN_TOKEN before public deployment. Set official business account details before enabling e-wallet methods.
python -m uvicorn app:app --reload
```

## Customer accounts and ordering

- Use the storefront Login / Register button to create an account or sign in. Registration requires name, email, mobile number, password confirmation, and acceptance of the terms/privacy checkbox. Passwords are hashed; the API issues an expiring customer session token.
- Guests can browse, add items, and place orders without signing in (provided guest ordering remains enabled).
- Logged-in customers can open their account panel and view order history associated with their account. Orders created while authenticated are linked to that customer; older guest orders are not automatically reassigned.
- Customers can continue ordering without using the Burger King website at runtime. The Burger King Philippines site is only a visual/interaction reference; Burger Haven retains its own name, logo, design, and assets.

## Menu sizes and price variants

- Eligible burgers, sandwiches, and sides offer Small, Medium, Large, and XL variants. Sample default price tiers are provided in the backend and are shown in the product customization flow. The authoritative price is calculated by the backend and stored with the order.
- Bottled Mineral Water and Lipton Iced Tea use configurable sample size prices in the starter menu. Do not assume those labels represent actual sealed-bottle volume; configure the exact packaging volume before launch.
- Soft-drink brands include Sprint, Sprite, Royal, Coke, Pepsi, 7-Up, Mirinda, and Mountain Dew. The starter cup sizes are Small (250 ml, ₱25), Medium (330 ml, ₱35), Large (500 ml, ₱50), and XL (700 ml, ₱60). These are editable sample values, not a verified supplier price list.
- Staff can set all four size prices for a product in the menu editor. Leave all four fields blank to use that product's configured starter defaults. Soft-drink cup prices are configured in `DRINK_VARIANTS` in `app.py`.
- B1T1 items are charged once per promotion unit, and one unit includes two sandwiches. Size variants are intentionally not applied to B1T1 items so the advertised price/promotion is not accidentally altered.

## 2. Payment setup — no payment API

- **Cash:** enabled by default. Staff must press “Confirm cash collected” only after receiving the full cash amount.
- **GCash / Maya:** enter the official business account name and mobile number in `.env`, then restart the app. The payment option remains disabled while account details are missing or placeholders. The customer transfers money in their own wallet app, then submits the transaction reference and optional screenshot. Staff must check the actual transaction in the business merchant account and then approve or reject the claim.
- No payment gateway SDK, e-wallet API, automated payment confirmation, or simulated real payment is included.
- The official account details are not prefilled; the business owner must configure them. Do not accept real customer payments until account details and the staff verification process have been checked.

## 3. Staff dashboard

Navigate to `/admin` and sign in with an account whose role is `staff` or `admin`, or enter the configured `STAFF_TOKEN` / `ADMIN_TOKEN` value from `.env`.

**Account roles.** Every account is a `customer` unless promoted. Public registration can never grant a role. Promote an account from the server (the person must register first):

```bash
python manage_users.py list
python manage_users.py set-role cashier@example.com staff
python manage_users.py set-role owner@example.com admin
python manage_users.py set-role cashier@example.com customer   # remove access
```

The role is checked on every API request, so promotions and demotions apply immediately and customer sessions receive `403` from every `/api/admin/*` and `/api/analytics` endpoint. The `/admin` and `/analytics` HTML pages are only sign-in screens; all data and actions are protected by the API. Activity-log entries still record `admin` rather than the individual user.

Shared tokens work as before:  The token is held in browser `sessionStorage` for the tab session. When `STAFF_TOKEN` is configured, it grants operations access but not analytics. The administrator token opens the analytics dashboard at `/analytics`. This is still a shared-token login, not per-person staff identity; before a public commercial launch, replace it with individual accounts/roles and secure sessions, and deploy only over HTTPS.

Staff can:
- Review and filter recent orders.
- Open payment receipt images through an admin-only endpoint.
- Approve or reject pending GCash/Maya claims with a recorded reason.
- Confirm cash collection.
- Update order status using server-validated transitions.
- View paid sales and order counts.

## 4. Database and uploads

SQLite is the default database for local development. The app creates `burger_haven.db` on first startup. Order records, item price snapshots, status events, and payment decisions are persisted. Receipt images are stored under `uploads/` and are not mounted as public static files. Back up the database and uploads folder together. The app uses a local filesystem for uploads; use private object storage and appropriate retention policies for a high-volume deployment.

## 5. Tests

Install the test dependencies and run:

```bash
python -m pip install pytest httpx
python -m pytest -q
```

Automated tests cover cash collection, order-token protection, GCash manual claim/approval, server-side totals, checkout idempotency, customer registration/login/session/order history, customer order edits and ownership, order-edit audit history, staff/admin analytics permissions, expanded catalog entries, server-authoritative size pricing, and administrator variant-price configuration. They use a temporary SQLite database and test payment account values.

## 6. Docker

After configuring `.env`:

```bash
docker compose up --build -d
```

The Compose file persists the database in `./data` and receipt uploads in `./uploads`. The service binds to port 8000. Put it behind HTTPS and a production reverse proxy before public exposure.


## 7. Online school-project deployment (Railway + GitHub)

**Framework note:** this project uses **FastAPI**, not Flask. Keep the existing FastAPI application; the `Dockerfile` starts Uvicorn and reads the hosting platform's `PORT` value.

For the least disruptive online deployment, use GitHub for the repository and Railway for the container. Keep SQLite for this small school project and attach a Railway persistent volume at `/data`. Set both `DATABASE_PATH` and `UPLOAD_DIR` to that mounted volume so order records and private receipt uploads survive restarts and redeploys. Do not deploy this SQLite setup with a service that has only an ephemeral filesystem.

### Deploy steps

1. Extract the ZIP. Create a GitHub repository and upload the **contents of this `Burger_Haven_App` folder** to the repository root. Do not upload `.env`, a real database file, or real customer receipts.
2. In Railway, create a project and deploy the GitHub repository. Railway detects the included `Dockerfile` at the repository root.
3. Add a persistent volume to the app service and set its mount path to `/data`.
4. In the service's Variables settings, add the following values. Use your own actual merchant account details only if you are authorized to accept the payments:

   ```env
   ADMIN_TOKEN=<a-long-random-secret>
   STAFF_TOKEN=<optional-separate-staff-only-secret>
   DATABASE_PATH=/data/burger_haven.db
   UPLOAD_DIR=/data/uploads
   GCASH_ACCOUNT_NAME=<official-GCash-account-name>
   GCASH_NUMBER=<official-GCash-number>
   GCASH_QR_IMAGE=
   MAYA_ACCOUNT_NAME=<official-Maya-account-name>
   MAYA_NUMBER=<official-Maya-number>
   MAYA_QR_IMAGE=
   CASH_ENABLED=true
   CASH_ON_DELIVERY=true
   CASH_ON_PICKUP=true
   DELIVERY_FEE_PHP=30
   MINIMUM_ORDER_PHP=0
   ```

   Set `ADMIN_TOKEN` to a unique secret, not the sample token from `.env.example`. Generate one locally with `python -c "import secrets; print(secrets.token_urlsafe(40))"`. Do not include angle-bracket placeholders or quotes in the real values.
5. Deploy the service and wait for the deployment health check to complete. Open the generated public URL. Check `/api/health`, the storefront `/`, the staff dashboard `/admin`, and the administrator analytics page `/analytics`. Keep `STAFF_TOKEN` separate from `ADMIN_TOKEN` if ordinary staff must not see business analytics.
6. Test a customer order, GCash/Maya proof submission, receipt viewing from the staff dashboard, approval and rejection, COD, login/order history, and analytics. Verify actual wallet transfers yourself; a receipt image is not proof that funds arrived.
7. Back up `/data/burger_haven.db` and `/data/uploads` before making major changes. The volume is limited storage, not a backup strategy.

### Cost and limits

Railway currently lists 0.5 GB volumes for its Free plan and $1/month in included usage credit. Usage beyond included credit may require payment or service changes. Check Railway's current [pricing](https://docs.railway.com/pricing/plans) and [volume documentation](https://docs.railway.com/volumes/reference) before deployment. This is suitable for a classroom demonstration, not a high-traffic commercial ordering service. For a larger production deployment, migrate to a managed database and private object storage instead of running SQLite on one volume.

### Analytics and scenario planner

The `/analytics` page requires an `admin` account (or `ADMIN_TOKEN`) and retrieves sales metrics from the SQLite database through the protected `/api/analytics` endpoint. Staff accounts and staff tokens do not grant analytics access. The page includes the last 30 days of recorded revenue, order status totals, and best-selling products. Its hypothetical scenario planner recalculates automatically as the administrator changes quantities/prices/cost assumptions; it is separate from actual sales and does not change live orders or database records. No PyScript CDN is required.

## 8. Production launch checklist

This is a production-oriented starter, not a claim that a deployment has already been penetration-tested or legally approved. Before public launch:

- Set a long unique `ADMIN_TOKEN`; give each staff member their own account with `manage_users.py` and stop sharing tokens; per-person names in the activity log are still a to-do.
- Use HTTPS, secure hosting, secrets management, backups, monitoring, and a tested recovery process.
- Confirm business permission to display the GCash/Maya account details and QR codes.
- Test manual reconciliation, rejected claims, duplicate submissions, cancellations, refund handling, staff procedures, and order fulfilment end-to-end.
- Review privacy notice, retention/deletion rules, consumer disclosures, and applicable Philippine privacy/consumer requirements.
- Configure production database and private object storage if traffic requires it.
- Run the automated tests and browser testing in your deployment environment.

No prompt or codebase can guarantee zero bugs or zero delay. This package includes a few automated workflow tests and must still be tested in the target hosting environment before it is relied on for real business operations.


## Soft drink size prices

The current cup-size samples are Small 250 ml = ₱25, Medium 330 ml = ₱35, Large 500 ml = ₱50, and XL 700 ml = ₱60. To change them, edit `DRINK_VARIANTS` in `app.py`. Brand options are Sprint, Sprite, Royal, Coke, Pepsi, 7-Up, Mirinda, and Mountain Dew. These are example menu configurations; confirm actual products, volumes, and business prices before accepting orders.
