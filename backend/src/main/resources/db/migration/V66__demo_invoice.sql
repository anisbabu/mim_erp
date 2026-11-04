-- Bangla display name for users (shown next to the English name on slips)
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS full_name_bn varchar(255);

-- Saved demo (proforma) invoices: unique code, full payload kept so the exact slip can be reprinted
CREATE TABLE IF NOT EXISTS demo_invoice (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code          varchar(32) NOT NULL UNIQUE,
    demo_date     date NOT NULL DEFAULT CURRENT_DATE,
    customer_name varchar(255),
    customer_mobile varchar(64),
    salesperson   varchar(255),
    total         numeric(14,2) NOT NULL DEFAULT 0,
    payload       jsonb NOT NULL,
    created_by    uuid,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demo_invoice_date ON demo_invoice (demo_date DESC, created_at DESC);
