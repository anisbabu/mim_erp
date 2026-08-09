-- =====================================================================
-- V21 — Cheque maturity extensions. A cheque's maturity date can be
-- pushed back (customer asks for more time before deposit); each push
-- is logged here — who asked, who processed it, old/new date — so the
-- office has a full audit trail instead of just overwriting the date.
-- =====================================================================

ALTER TABLE cheque DROP CONSTRAINT chk_cheque_status;
ALTER TABLE cheque ADD CONSTRAINT chk_cheque_status
    CHECK (status IN ('PENDING','CLEARED','BOUNCED','EXTENDED'));

CREATE TABLE cheque_extension (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cheque_id        UUID NOT NULL REFERENCES cheque(id),
    old_maturity_date DATE NOT NULL,
    new_maturity_date DATE NOT NULL,
    requested_by     VARCHAR(120) NOT NULL,
    note             VARCHAR(255),
    extended_by      UUID NOT NULL REFERENCES app_user(id),
    extended_by_name VARCHAR(120) NOT NULL,
    extended_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cheque_extension_cheque ON cheque_extension(cheque_id);
