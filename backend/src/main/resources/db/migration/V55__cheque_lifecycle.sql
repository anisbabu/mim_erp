-- =====================================================================
-- V55 — Cheque lifecycle. A received cheque is only tracked until it is
-- posted: RECEIVED → (HOLD / date change) → CASHED → POSTED, or BOUNCED.
-- The accounting entry (Dr Bank / Cr customer) is made on POST, so the
-- payment link becomes optional. Every step is logged in cheque_event,
-- which replaces the extension-only cheque_extension log.
-- =====================================================================

ALTER TABLE cheque ALTER COLUMN payment_id DROP NOT NULL;

ALTER TABLE cheque DROP CONSTRAINT chk_cheque_status;
UPDATE cheque SET status = 'POSTED'  WHERE status = 'CLEARED';
UPDATE cheque SET status = 'PENDING' WHERE status = 'EXTENDED';
ALTER TABLE cheque ADD CONSTRAINT chk_cheque_status
    CHECK (status IN ('PENDING','HOLD','CASHED','POSTED','BOUNCED'));

CREATE TABLE cheque_event (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cheque_id         UUID NOT NULL REFERENCES cheque(id),
    event_type        VARCHAR(20) NOT NULL,
    event_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    old_maturity_date DATE,
    new_maturity_date DATE,
    requested_by      VARCHAR(120),
    note              VARCHAR(255),
    user_id           UUID REFERENCES app_user(id),
    user_name         VARCHAR(120),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_cheque_event_type CHECK (event_type IN
        ('RECEIVED','DATE_CHANGED','HOLD','RESUMED','CASHED','POSTED','BOUNCED'))
);
CREATE INDEX idx_cheque_event_cheque ON cheque_event(cheque_id);

INSERT INTO cheque_event (cheque_id, event_type, event_date, old_maturity_date, new_maturity_date,
                          requested_by, note, user_id, user_name, created_at)
SELECT cheque_id, 'DATE_CHANGED', extended_at::date, old_maturity_date, new_maturity_date,
       requested_by, note, extended_by, extended_by_name, extended_at
FROM cheque_extension;

DROP TABLE cheque_extension;
