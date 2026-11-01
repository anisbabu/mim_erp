-- =====================================================================
-- V57 — Fix cheques entered by mistake. A pending or held cheque can be
-- edited (EDITED event keeps a readable old → new diff in `changes`) or
-- cancelled (CANCELLED status + event). Neither touches the books.
-- =====================================================================

ALTER TABLE cheque DROP CONSTRAINT chk_cheque_status;
ALTER TABLE cheque ADD CONSTRAINT chk_cheque_status
    CHECK (status IN ('PENDING','HOLD','CASHED','POSTED','BOUNCED','CANCELLED'));

ALTER TABLE cheque_event DROP CONSTRAINT chk_cheque_event_type;
ALTER TABLE cheque_event ADD CONSTRAINT chk_cheque_event_type CHECK (event_type IN
    ('RECEIVED','DATE_CHANGED','HOLD','RESUMED','CASHED','POSTED','BOUNCED','EDITED','CANCELLED'));

ALTER TABLE cheque_event ADD COLUMN changes TEXT;
