# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Backend:** Java 23 + Spring Boot 3.4.1, Maven, PostgreSQL + Flyway migrations
- **Frontend:** Next.js 14 (App Router) + React 18 + TypeScript 5, Tailwind CSS

## Commands

### Backend
```bash
cd backend
mvn spring-boot:run          # dev server on :8080
mvn clean install            # build + test
mvn test                     # tests only
```

### Frontend
```bash
cd frontend
npm run dev                  # dev server on :3000
npm run build
npm run lint
```

### Database
```
DB: merry_erp (default via env DB_URL)
Flyway auto-runs migrations (V1–V9) on startup.
Override: DB_URL, DB_USER, DB_PASS, JWT_SECRET env vars.
```

Default admin: `admin` / `admin123`

## Architecture

### Backend packages (`com.mim.erp`)
- `auth/` — JWT (HS256) + stateless Spring Security. Roles: Salesperson, Manager, Accountant, Admin.
- `common/` — CORS, error handling, document-number generation, double-entry posting helpers.
- `master/` — CRUD: Products, Suppliers, Customers, Shops, Warehouses.
- `purchase/` — POs + partial Goods Receipt (GRN). PO auto-closes at zero balance.
- `inventory/` — FIFO stock layers per warehouse. Pessimistic locking prevents over-consumption. `StockLayer` is the core entity.
- `sales/` — Two workflows: **SO_FIRST** (order → auto-split per-warehouse challans) and **DC_FIRST** (challans first → day-end consolidation). Price-band and credit-limit checks with loggable overrides.
- `accounting/` — Perpetual double-entry engine (balanced-entry enforced). Auto-posts on receipt (Inventory↑/AP) and sale (Revenue + COGS/Inventory↓). Reports: trial balance, P&L, balance sheet.
- `hr/` — Employee management.

### Frontend (`frontend/app/`)
- App Router (file-based). All pages are under `app/(dashboard)/` except `login/`.
- `lib/api.ts` — typed API client (JWT-aware). All API calls go through this; don't fetch directly.
- `lib/auth.tsx` — `AuthContext` + `useAuth()` hook. `activeShopId` is central to sales/purchase scoping.
- `lib/i18n.tsx` — Bengali/English i18n.
- `components/SearchSelect.tsx` — reusable async-searchable dropdown.
- `components/Shell.tsx` — sidebar + header layout.

### CSS conventions
- `globals.css` defines component classes: `.inp`, `.btn`, `.btn-ghost`, `.field`, `.form-grid`, `.tbl`, `.card`, `.chip`, `.note`.
- `.tbl td` sets `align-middle` globally. Override with `style={{ verticalAlign: 'top' }}` (inline style wins) not the `.align-top` Tailwind class (which loses to the compound selector).
- Hint rows (band info, warnings) below inputs must always render with a fixed height (`h-4 leading-4`) so row height stays stable on state changes.
- Theme tokens: `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--input-bg`, etc. Dark mode via `html.dark`.
- Brand color: teal (`#0f766e` / `bg-brand`).

### API proxy
`next.config.js` rewrites `/api/*` → `http://localhost:8080/api/*` in dev. No CORS headers needed from frontend.