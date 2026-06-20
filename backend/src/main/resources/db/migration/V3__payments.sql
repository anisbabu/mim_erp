-- =====================================================================
-- V3 — Payments (settle Accounts Payable to suppliers and Accounts
-- Receivable from customers). Petty cash and stock adjustment tables
-- already exist in V1; this adds the cash-movement document.
-- =====================================================================

CREATE TABLE payment (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_no    VARCHAR(30) NOT NULL UNIQUE,
    direction     VARCHAR(10) NOT NULL,   -- OUT (pay supplier) | IN (receive from customer)
    party_type    VARCHAR(10) NOT NULL,   -- SUPPLIER | CUSTOMER
    party_id      UUID NOT NULL,          -- supplier.id or customer.id
    amount        NUMERIC(16,2) NOT NULL CHECK (amount > 0),
    method        VARCHAR(20) NOT NULL DEFAULT 'CASH',  -- CASH | BANK
    note          VARCHAR(255),
    payment_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_pay_dir   CHECK (direction IN ('OUT','IN')),
    CONSTRAINT chk_pay_party CHECK (party_type IN ('SUPPLIER','CUSTOMER'))
);
CREATE INDEX idx_payment_party ON payment(party_type, party_id);
