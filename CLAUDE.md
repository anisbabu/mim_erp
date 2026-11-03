# CLAUDE.md

## Stack
- Backend: Java 23 + Spring Boot 3.4.1, Maven, PostgreSQL 16 + Flyway
- Frontend: Next.js 14 (App Router) + React 18 + TypeScript 5, Tailwind

## Run (Docker — normal way)
```bash
docker compose up -d --build backend    # API :8082, runs Flyway on start
docker compose up -d --build frontend   # web :3001 (host 3000 taken)
docker exec mim-postgres psql -U postgres -d mim_erpdb   # DB, host port 5440
```
Local dev without Docker: `cd backend && mvn spring-boot:run`, `cd frontend && npm run dev`.
Migrations: `backend/src/main/resources/db/migration/V*.sql` — next number = highest + 1.
Default admin: `admin` / `admin123`. Old Neon DB = env `DB_URL`/`DB_USER`/`DB_PASS` (read-only source).

## Backend (`com.mim.erp`)
- `auth/` JWT HS256, stateless. Roles: SALESPERSON, MANAGER, ACCOUNTANT, ADMIN. `user_shop` = shop access.
- `common/` CORS, errors (`ApiException`), doc numbers, double-entry helpers.
- `master/` Products, Suppliers, Customers, Shops, Warehouses (`MasterController`). Most have `name_bn`.
- `purchase/` POs + partial GRN; PO auto-closes at zero balance.
- `inventory/` FIFO `StockLayer` per warehouse, pessimistic locking; stock movements, committed stock.
- `sales/` SO_FIRST (order → per-warehouse challans) and DC_FIRST (challans → day-end consolidation). Price-band + credit-limit checks with logged overrides.
- `accounting/` balanced double-entry; auto-post on receipt and sale. Trial balance, P&L, balance sheet.
- `hr/` employees (customer.salesperson_id → employee).

## Frontend (`frontend/`)
- Pages directly under `app/` (sales, purchase, inventory, accounting, master, hr, admin, login).
- `lib/api.ts` typed API client — all calls go through it. `lib/auth.tsx` `useAuth()`, `activeShopId` scopes sales/purchase. `lib/i18n.tsx` EN/BN `t()`.
- `components/Shell.tsx` layout, `components/SearchSelect.tsx` async dropdown.
- `/api/*` proxied to backend by `next.config.js` (`BACKEND_URL`).

## CSS rules
- Classes in `globals.css`: `.inp .btn .btn-ghost .field .form-grid .tbl .card .chip .note`.
- `.tbl td` is `align-middle`; override with inline `style={{ verticalAlign: 'top' }}`, not `.align-top`.
- Hint rows under inputs: fixed `h-4 leading-4` so row height never jumps.
- Theme tokens `--bg --surface --text --muted --border --input-bg`; dark mode via `html.dark`. Brand teal `#0f766e` / `bg-brand`.

## UI standard (lists and forms)
- Every page starts with `components/PageHeader.tsx`: breadcrumb (`["Accounting","Setup"]`), title, one-line subtitle, primary actions on the right.
- List pages: toolbar row (search, filter chips, secondary toggles) above one `.card .table-wrap` table; numbers right-aligned `.num`; totals/status as `.chip`.
- Create/edit forms: right-hand `components/Drawer.tsx` (Save/Cancel in footer, Enter saves, Esc closes), required marked `*`, inline errors in the fixed `h-4` hint row. Long transaction forms (journal, payment) stay as a page `.card`.
- Sidebar: `Shell.tsx` groups with captions (Setup / Transactions / Reports), lucide icon per item, collapsible groups; add `also:` paths so a hub page stays highlighted.
- Terms: Group (totals only) / Ledger (posted to); Receipts & payments; Financial reports. All text through `t()` with EN + BN.

## Don't read
`document/` (dumps, CSV backups), `node_modules`, `.next`, `target`, lockfiles — blocked in `.claude/settings.json`.
