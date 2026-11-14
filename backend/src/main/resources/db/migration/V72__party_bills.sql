-- =====================================================================
-- V72 - Bill-wise party sub-ledger.
--   party_item      : one row per party-ledger line that opens a bill
--                     (customer debit / supplier credit: invoice, GRN, opening,
--                     bounced cheque) or a credit (receipt, payment, credit note,
--                     advance). Rows are filled by the posting engine.
--   bill_allocation : which credit settled which bill, and how much.
-- Invariant: party ledger balance = open bills - open credits (advances).
-- Rows are (re)built by the backend on start when empty (BillService.rebuild).
-- =====================================================================

CREATE TABLE party_item (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_type   VARCHAR(20)   NOT NULL,                  -- CUSTOMER | SUPPLIER
    party_id     UUID          NOT NULL,
    account_id   UUID          NOT NULL REFERENCES account(id),
    kind         VARCHAR(6)    NOT NULL,                  -- BILL | CREDIT
    source_type  VARCHAR(30)   NOT NULL,                  -- journal source type, or OPENING
    source_id    UUID,
    journal_id   UUID REFERENCES journal_entry(id),
    opening_id   UUID REFERENCES opening_balance(id) ON DELETE CASCADE,
    doc_no       VARCHAR(60),
    doc_date     DATE          NOT NULL,
    due_date     DATE          NOT NULL,
    amount       NUMERIC(16,2) NOT NULL CHECK (amount > 0),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_item_kind  CHECK (kind IN ('BILL','CREDIT')),
    CONSTRAINT chk_item_party CHECK (party_type IN ('CUSTOMER','SUPPLIER'))
);
CREATE INDEX idx_party_item_account ON party_item(account_id, kind, due_date);
CREATE INDEX idx_party_item_journal ON party_item(journal_id);

CREATE TABLE bill_allocation (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id     UUID          NOT NULL REFERENCES party_item(id) ON DELETE CASCADE,
    credit_id   UUID          NOT NULL REFERENCES party_item(id) ON DELETE CASCADE,
    amount      NUMERIC(16,2) NOT NULL CHECK (amount > 0),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by  VARCHAR(60)
);
CREATE INDEX idx_alloc_bill   ON bill_allocation(bill_id);
CREATE INDEX idx_alloc_credit ON bill_allocation(credit_id);
