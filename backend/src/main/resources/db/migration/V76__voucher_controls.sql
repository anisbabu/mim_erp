-- Internal controls: maker-checker approval for vouchers, contra vouchers, manual bill matching.

-- Payments / contra above this amount entered by anyone but an admin wait for approval. No row = off.
CREATE TABLE voucher_request (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_no    VARCHAR(30)   NOT NULL UNIQUE,
    kind          VARCHAR(10)   NOT NULL CHECK (kind IN ('PAYMENT', 'CONTRA')),
    party_type    VARCHAR(20),
    party_id      UUID,
    amount        NUMERIC(16,2) NOT NULL CHECK (amount > 0),
    voucher_date  DATE          NOT NULL,
    summary       VARCHAR(300),
    payload       JSONB         NOT NULL,
    status        VARCHAR(10)   NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    requested_by  VARCHAR(60)   NOT NULL,
    requested_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    decided_by    VARCHAR(60),
    decided_at    TIMESTAMPTZ,
    decision_note VARCHAR(300),
    posted_id     UUID,
    posted_no     VARCHAR(30)
);
CREATE INDEX idx_voucher_request_status ON voucher_request(status, requested_at);

-- Money moved between our own cash and bank ledgers.
CREATE TABLE contra_voucher (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_no    VARCHAR(30)   NOT NULL UNIQUE,
    voucher_date  DATE          NOT NULL,
    from_account  VARCHAR(30)   NOT NULL,
    to_account    VARCHAR(30)   NOT NULL,
    amount        NUMERIC(16,2) NOT NULL CHECK (amount > 0),
    reference     VARCHAR(100),
    note          VARCHAR(300),
    requested_by  VARCHAR(60),
    approved_by   VARCHAR(60),
    created_by    VARCHAR(60),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK (from_account <> to_account)
);

ALTER TABLE payment ADD COLUMN IF NOT EXISTS requested_by VARCHAR(60);
ALTER TABLE payment ADD COLUMN IF NOT EXISTS approved_by VARCHAR(60);

-- hand-picked matches are kept when the bill-wise items are rebuilt
ALTER TABLE bill_allocation ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT FALSE;
