# MIM Enterprise ERP

Single application for **Purchase, Inventory, Sales and Accounting** for a plywood-board
and hardware trading business. Spring Boot (Java 21) + Next.js (TypeScript) + PostgreSQL.

The API is stateless JSON under `/api/*`, so the same backend serves the Next.js web app
**and** a Flutter mobile app.

---


## Authentication, roles & shop binding

The API is secured with **JWT bearer auth** (Spring Security, stateless). Every request
except `POST /api/auth/login` requires a valid token.

**Roles and what they can do:**

| Role | Shops | Can do |
|---|---|---|
| **Salesperson** | exactly one (assigned at user creation) | raise sales/challans for their own shop only; read stock |
| **Manager** | one or more | purchasing, stock adjustments, sales for any of their shops, reports |
| **Accountant** | company-wide | payments/receipts, petty cash, financial statements |
| **Admin** | company-wide | everything, including user management and master data |

**Shop binding happens at user creation.** A salesperson's shop is taken from their
account at sale time — they never pick it, and the backend forces it regardless of what
the client sends (`SalesService.resolveShop`). Managers choose among their assigned shops;
admins can pick any.

**First login.** On first run the app seeds an admin (`ADMIN_USERNAME`/`ADMIN_PASSWORD`,
default `admin` / `admin123`) if no admin exists. Sign in, then create the real users under
**Administration → Users**. Change the admin password env vars before any real deployment.

Config (env, with defaults):
```
JWT_SECRET=...           # HS256 secret, >= 32 bytes; CHANGE in production
JWT_EXPIRY_MINUTES=480
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

> The web app stores the JWT in localStorage for simplicity. For higher security you can
> switch to httpOnly cookies; the API contract doesn't change.

## What this repository contains

This is a **working foundation** with the hard business logic implemented end to end —
the parts that are painful to get right — plus the project structure so the remaining
CRUD screens are mechanical to add.

### Implemented and wired together

| Area | What works |
|---|---|
| **Schema** | Full PostgreSQL schema (Flyway `V1`) for all four modules + chart of accounts + seed data (`V2`) |
| **Purchase** | Create PO; receive against a PO into one warehouse; **partial receipt** reduces each line's open balance; multiple receipts per line; PO auto-closes at zero balance; received price locked to PO price |
| **Inventory** | **FIFO cost layers** — one layer per receipt line; quantity merges per (product, warehouse) by summing, price kept per layer; per-warehouse availability; pessimistic locking so concurrent sales can't double-consume a layer |
| **Sales** | Both workflows — **SO_FIRST** (order → auto-split into per-warehouse challans) and **DC_FIRST** (issue challans during day → consolidate into one invoice at day end); negotiated price entered as **unit or line total**; **price-band** validation + below-cost guard with logged override; **credit-limit** check with logged override; stock deducts at the challan via FIFO; margin (price − FIFO cost) captured per line |
| **Accounting** | Perpetual double-entry posting engine; balanced-entry enforcement; auto-posts Inventory↑/AP on receipt, and Revenue + COGS↓Inventory on sale; trial balance report |
| **Web UI** | Dashboard; **Receive goods** screen (side-by-side ordered/balance with editable receive qty + live new-balance); **New sale** screen (product → live per-warehouse stock, qty allocation, unit↔total price, band warnings) |

### Now built out across the full app

Every module below is implemented end-to-end — backend service + REST endpoint + a
web screen to drive it:

- **Master data CRUD**: products (with price band + thickness), suppliers, customers
  (with credit terms), shops (target + petty-cash float), warehouses.
- **Purchase**: create PO screen, PO list, receive-goods screen.
- **Inventory**: stock-on-hand (qty + FIFO value), price-variance report (per-warehouse
  and company-wide toggle), stock adjustments (damage / count / transfer).
- **Sales**: order-first sale, issue-challan (delivery-first), day-end consolidate, sales-order list.
- **Accounting**: payments & receipts (settle AP/AR), petty-cash vouchers, trial balance,
  profit & loss, balance sheet.

The web app has 21 screens; the backend exposes the matching REST endpoints. Both the
TypeScript typecheck and the Next.js production build pass clean.

### What a production rollout still needs

- **Auth**: wire Spring Security + JWT before exposing the API (web + Flutter share it).
- **Edit/void flows**: screens currently create + list; add update/cancel where your
  process needs them (cancel PO, void challan, reverse a journal entry).
- **Document PDFs**: printable PO / challan / invoice (the data is all there).
- **Pagination & filters** on the list screens once data volume grows.
- **Tax activation**: the schema and posting engine are tax-aware; switch it on when needed.

---

## Architecture decisions baked in

- **FIFO costing.** `stock_layer` keeps `(qty_remaining, unit_cost, received_date, seq)`
  per receipt. `InventoryService.consumeFifo` walks open layers oldest-first and returns
  per-layer allocations, which become `dc_line` rows — so cost of every sale traces to exact layers.
- **Perpetual inventory.** Inventory value lives on the books continuously; COGS moves off
  the balance sheet at the moment of delivery, not at month end.
- **Challan = single warehouse.** A multi-warehouse sale produces multiple challans under one
  order. Enforced in schema (`delivery_challan.warehouse_id`) and in `SalesService`.
- **Two sales workflows** differ only in document order; both deduct stock at the challan and
  post the same ledger effects.
- **Tax-aware, inactive.** `product.tax_rate` and the posting engine can carry tax later with
  no rework; nothing is calculated now.
- **Overrides are logged.** `so_line.price_override_by` and `sales_order.credit_override_by`
  record who authorised an out-of-band price or over-limit credit sale.

---

## Running it

### 1. PostgreSQL

```bash
createdb mim_erp
createuser mim --pwprompt          # set password 'mim' (or change env vars below)
psql -d mim_erp -c "GRANT ALL ON SCHEMA public TO mim;"
```

### 2. Backend (Spring Boot)

```bash
cd backend
# env (defaults shown):
export DB_URL=jdbc:postgresql://localhost:5432/mim_erp
export DB_USER=mim
export DB_PASS=mim
export CORS_ORIGINS=http://localhost:3000

mvn spring-boot:run
```

Flyway applies `V1__schema.sql` and `V2__seed.sql` automatically on first start.
API comes up on `http://localhost:8080`.

> Note: this project uses Java 21. Maven downloads Spring Boot dependencies from Maven Central
> on first build, so the first `mvn` run needs internet access.

### 3. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

`next.config.js` proxies `/api/*` to the backend, so the browser uses one origin.

### Smoke test

1. Open **Receive goods** → pick the seeded open PO… (first create one via
   `POST /api/purchase/orders` — see below), choose a warehouse, receive partial qty,
   watch the balance update.
2. Open **New sale** → pick a product, see per-warehouse availability, allocate, price it,
   create the sale. Check `GET /api/accounting/trial-balance` to see the balanced postings.

Create a PO quickly:

```bash
curl -s localhost:8080/api/master/products | jq '.[0].id'     # grab a product id
curl -s localhost:8080/api/master/suppliers                    # (add a supplier first via POST)
curl -X POST localhost:8080/api/purchase/orders \
  -H 'Content-Type: application/json' \
  -d '{"supplierId":"<SUPPLIER_UUID>","note":"first PO",
       "lines":[{"productId":"<PRODUCT_UUID>","qty":200,"unitPrice":1260}]}'
```

---

## Project layout

```
backend/
  src/main/resources/db/migration/   V1 schema, V2 seed (Flyway)
  src/main/java/com/mim/erp/
    common/      CORS, error handling, document-number + posting helpers
    master/      Product, Warehouse, Supplier, Shop, Customer (+ repos, controller)
    purchase/    PO, GRN entities + PurchaseService (partial receipt) + controller
    inventory/   StockLayer + InventoryService (FIFO) + controller
    sales/       SalesOrder, DeliveryChallan + SalesService (both workflows) + controller
    accounting/  Account, JournalEntry/Line + AccountingService (double-entry)
frontend/
  lib/api.ts                         typed API client (reused by Flutter conceptually)
  app/                               dashboard, purchase/receive, sales/new
```

## Flutter

Point the Flutter app at the same `/api/*` endpoints. Use JWT bearer auth (add Spring Security
when you wire real users) so web and mobile share one stateless API. The DTO shapes in
`frontend/lib/api.ts` are the contract to mirror in Dart models.
