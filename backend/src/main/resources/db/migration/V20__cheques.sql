-- =====================================================================
-- V20 — Cheques received from customers. Tracks the physical cheque
-- (number, bank, maturity date) behind a BANK/IN payment so the office
-- can watch for cheques nearing their deposit/maturity date and record
-- whether they cleared or bounced.
-- =====================================================================

CREATE TABLE cheque (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id     UUID NOT NULL REFERENCES payment(id),
    cheque_no      VARCHAR(40) NOT NULL,
    bank_name      VARCHAR(120),
    customer_id    UUID NOT NULL,
    amount         NUMERIC(16,2) NOT NULL CHECK (amount > 0),
    receive_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    maturity_date  DATE NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    note           VARCHAR(255),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_cheque_status CHECK (status IN ('PENDING','CLEARED','BOUNCED'))
);
CREATE INDEX idx_cheque_maturity ON cheque(maturity_date);
CREATE INDEX idx_cheque_status ON cheque(status);
CREATE INDEX idx_cheque_customer ON cheque(customer_id);
