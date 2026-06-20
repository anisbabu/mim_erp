-- =====================================================================
-- MIM Enterprise ERP — PostgreSQL schema (V1)
-- Modules: Master, Purchase, Inventory (FIFO layers), Sales, Accounting
-- Costing: FIFO  |  Inventory: perpetual  |  Tax: schema-aware, inactive
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ---------- helper: updated_at trigger ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- MASTER DATA
-- =====================================================================

CREATE TABLE warehouse (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(20)  NOT NULL UNIQUE,        -- WH1..WH5
    name        VARCHAR(120) NOT NULL,
    address     VARCHAR(255),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE shop (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(20)  NOT NULL UNIQUE,    -- SHOP1..SHOP5
    name            VARCHAR(120) NOT NULL,
    primary_line    VARCHAR(20)  NOT NULL,           -- BOARD | HARDWARE (primary, not a restriction)
    address         VARCHAR(255),
    mobile          VARCHAR(30),
    location        VARCHAR(255),
    monthly_target  NUMERIC(16,2) NOT NULL DEFAULT 0,
    petty_cash_float NUMERIC(16,2) NOT NULL DEFAULT 0, -- imprest fixed float
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE supplier (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30)  NOT NULL UNIQUE,
    name        VARCHAR(160) NOT NULL,
    mobile      VARCHAR(30),
    address     VARCHAR(255),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Plywood boards differ by thickness => thickness is part of the SKU.
-- Hardware items have no thickness.
CREATE TABLE product (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku           VARCHAR(40)  NOT NULL UNIQUE,
    name          VARCHAR(160) NOT NULL,
    type          VARCHAR(20)  NOT NULL,             -- BOARD | HARDWARE
    thickness_mm  NUMERIC(6,2),                      -- only for BOARD
    unit          VARCHAR(20)  NOT NULL DEFAULT 'PCS',
    -- management-maintained selling price band (fixed per product)
    price_lower   NUMERIC(16,2),
    price_upper   NUMERIC(16,2),
    tax_rate      NUMERIC(6,4),                       -- nullable: tax-aware, inactive
    active        BOOLEAN      NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_product_type CHECK (type IN ('BOARD','HARDWARE')),
    CONSTRAINT chk_board_thickness CHECK (type <> 'BOARD' OR thickness_mm IS NOT NULL)
);

CREATE TABLE customer (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(30)  NOT NULL UNIQUE,
    name          VARCHAR(160) NOT NULL,
    type          VARCHAR(20)  NOT NULL,             -- INDIVIDUAL | PARTY
    mobile        VARCHAR(30),
    address       VARCHAR(255),
    -- credit terms apply to PARTY only
    credit_limit  NUMERIC(16,2) NOT NULL DEFAULT 0,
    credit_days   INTEGER       NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_customer_type CHECK (type IN ('INDIVIDUAL','PARTY'))
);

-- =====================================================================
-- PURCHASE
-- =====================================================================

CREATE TABLE purchase_order (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_no        VARCHAR(30)  NOT NULL UNIQUE,
    supplier_id  UUID NOT NULL REFERENCES supplier(id),
    order_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    status       VARCHAR(20) NOT NULL DEFAULT 'OPEN',   -- OPEN | CLOSED | CANCELLED
    note         VARCHAR(255),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_po_status CHECK (status IN ('OPEN','CLOSED','CANCELLED'))
);

CREATE TABLE po_line (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id         UUID NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
    product_id    UUID NOT NULL REFERENCES product(id),
    qty_ordered   NUMERIC(16,2) NOT NULL CHECK (qty_ordered > 0),
    qty_balance   NUMERIC(16,2) NOT NULL,            -- starts = qty_ordered, -> 0
    unit_price    NUMERIC(16,2) NOT NULL CHECK (unit_price >= 0),  -- locked PO price
    line_no       INTEGER NOT NULL,
    CONSTRAINT chk_balance_range CHECK (qty_balance >= 0 AND qty_balance <= qty_ordered)
);
CREATE INDEX idx_po_line_po ON po_line(po_id);

-- A goods receipt happens INTO one warehouse (chosen at receipt time).
CREATE TABLE goods_receipt (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_no        VARCHAR(30)  NOT NULL UNIQUE,
    po_id         UUID NOT NULL REFERENCES purchase_order(id),
    warehouse_id  UUID NOT NULL REFERENCES warehouse(id),
    receipt_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE grn_line (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id        UUID NOT NULL REFERENCES goods_receipt(id) ON DELETE CASCADE,
    po_line_id    UUID NOT NULL REFERENCES po_line(id),
    qty_received  NUMERIC(16,2) NOT NULL CHECK (qty_received > 0)
);
CREATE INDEX idx_grn_line_grn ON grn_line(grn_id);

-- =====================================================================
-- INVENTORY — FIFO cost layers
-- One layer per GRN line. qty merges logically (SUM per product+warehouse)
-- but each layer keeps its own unit_cost + date for FIFO & variance report.
-- =====================================================================

CREATE TABLE stock_layer (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     UUID NOT NULL REFERENCES product(id),
    warehouse_id   UUID NOT NULL REFERENCES warehouse(id),
    grn_line_id    UUID REFERENCES grn_line(id),     -- source (null for opening/adjust)
    unit_cost      NUMERIC(16,4) NOT NULL,           -- locked purchase price
    qty_received   NUMERIC(16,2) NOT NULL,
    qty_remaining  NUMERIC(16,2) NOT NULL,
    received_date  DATE NOT NULL,
    seq            BIGSERIAL,                          -- FIFO tie-breaker within same date
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_layer_qty CHECK (qty_remaining >= 0 AND qty_remaining <= qty_received)
);
-- FIFO consumption order: oldest received_date, then lowest seq
CREATE INDEX idx_layer_fifo ON stock_layer(product_id, warehouse_id, received_date, seq)
    WHERE qty_remaining > 0;

-- Stock adjustments: damage, count correction, warehouse transfer
CREATE TABLE stock_adjustment (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adj_no        VARCHAR(30) NOT NULL UNIQUE,
    type          VARCHAR(20) NOT NULL,              -- DAMAGE | COUNT | TRANSFER
    product_id    UUID NOT NULL REFERENCES product(id),
    from_warehouse_id UUID REFERENCES warehouse(id),
    to_warehouse_id   UUID REFERENCES warehouse(id),
    qty           NUMERIC(16,2) NOT NULL,
    reason        VARCHAR(255),
    adj_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_adj_type CHECK (type IN ('DAMAGE','COUNT','TRANSFER'))
);

-- =====================================================================
-- SALES
-- Two workflows:
--   SO_FIRST : order -> challan(s)   (order drives delivery)
--   DC_FIRST : challan(s) during day -> consolidated order at day end
-- Challan is single-warehouse; multi-warehouse sale => multiple challans.
-- Stock deducts at the challan (physical movement) in both workflows.
-- =====================================================================

CREATE TABLE sales_order (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    so_no         VARCHAR(30)  NOT NULL UNIQUE,
    shop_id       UUID NOT NULL REFERENCES shop(id),
    customer_id   UUID NOT NULL REFERENCES customer(id),
    workflow      VARCHAR(10) NOT NULL,              -- SO_FIRST | DC_FIRST
    payment_mode  VARCHAR(10) NOT NULL,              -- CASH | CREDIT
    status        VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT|CONFIRMED|DELIVERED|INVOICED|CANCELLED
    order_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    credit_override_by VARCHAR(120),                 -- audit: who authorised over-limit
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_so_workflow CHECK (workflow IN ('SO_FIRST','DC_FIRST')),
    CONSTRAINT chk_so_paymode  CHECK (payment_mode IN ('CASH','CREDIT'))
);

CREATE TABLE so_line (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    so_id         UUID NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
    product_id    UUID NOT NULL REFERENCES product(id),
    qty           NUMERIC(16,2) NOT NULL CHECK (qty > 0),
    unit_price    NUMERIC(16,2) NOT NULL CHECK (unit_price >= 0),  -- negotiated
    price_override_by VARCHAR(120),                  -- audit: who authorised out-of-band price
    line_no       INTEGER NOT NULL
);
CREATE INDEX idx_so_line_so ON so_line(so_id);

CREATE TABLE delivery_challan (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dc_no         VARCHAR(30)  NOT NULL UNIQUE,
    so_id         UUID REFERENCES sales_order(id),   -- nullable in DC_FIRST until consolidated
    shop_id       UUID NOT NULL REFERENCES shop(id),
    customer_id   UUID NOT NULL REFERENCES customer(id),
    warehouse_id  UUID NOT NULL REFERENCES warehouse(id),  -- single warehouse per challan
    challan_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    status        VARCHAR(20) NOT NULL DEFAULT 'ISSUED',   -- ISSUED | CONSOLIDATED | CANCELLED
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_dc_status CHECK (status IN ('ISSUED','CONSOLIDATED','CANCELLED'))
);
CREATE INDEX idx_dc_so ON delivery_challan(so_id);
CREATE INDEX idx_dc_cust_date ON delivery_challan(customer_id, challan_date);

-- Each DC line consumes a specific FIFO layer (makes COGS concrete).
CREATE TABLE dc_line (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dc_id          UUID NOT NULL REFERENCES delivery_challan(id) ON DELETE CASCADE,
    product_id     UUID NOT NULL REFERENCES product(id),
    stock_layer_id UUID NOT NULL REFERENCES stock_layer(id),
    qty            NUMERIC(16,2) NOT NULL CHECK (qty > 0),
    unit_cost      NUMERIC(16,4) NOT NULL,            -- cost taken from the layer (FIFO)
    unit_price     NUMERIC(16,2) NOT NULL             -- negotiated selling price (for margin)
);
CREATE INDEX idx_dc_line_dc ON dc_line(dc_id);

-- =====================================================================
-- ACCOUNTING — double-entry, perpetual inventory
-- =====================================================================

CREATE TABLE account (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(20)  NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL,
    type        VARCHAR(20)  NOT NULL,               -- ASSET|LIABILITY|EQUITY|INCOME|EXPENSE
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_acct_type CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'))
);

CREATE TABLE journal_entry (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_no     VARCHAR(30) NOT NULL UNIQUE,
    entry_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    narration    VARCHAR(255),
    source_type  VARCHAR(30),                        -- GRN | SALES_DELIVERY | PAYMENT | RECEIPT | PETTY_CASH | ADJUSTMENT
    source_id    UUID,                               -- traces back to origin document
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_source ON journal_entry(source_type, source_id);

CREATE TABLE journal_line (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id  UUID NOT NULL REFERENCES journal_entry(id) ON DELETE CASCADE,
    account_id  UUID NOT NULL REFERENCES account(id),
    debit       NUMERIC(16,2) NOT NULL DEFAULT 0,
    credit      NUMERIC(16,2) NOT NULL DEFAULT 0,
    CONSTRAINT chk_dr_cr CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);
CREATE INDEX idx_journal_line_je ON journal_line(journal_id);
CREATE INDEX idx_journal_line_acct ON journal_line(account_id);

-- Petty cash voucher (imprest): expense out of a shop's float, replenished periodically
CREATE TABLE petty_cash_voucher (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_no   VARCHAR(30) NOT NULL UNIQUE,
    shop_id      UUID NOT NULL REFERENCES shop(id),
    amount       NUMERIC(16,2) NOT NULL CHECK (amount > 0),
    expense_account_id UUID NOT NULL REFERENCES account(id),
    description  VARCHAR(255),
    voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at triggers
CREATE TRIGGER t_wh   BEFORE UPDATE ON warehouse      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t_shop BEFORE UPDATE ON shop           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t_sup  BEFORE UPDATE ON supplier       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t_prod BEFORE UPDATE ON product        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t_cust BEFORE UPDATE ON customer       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t_po   BEFORE UPDATE ON purchase_order FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER t_so   BEFORE UPDATE ON sales_order    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
