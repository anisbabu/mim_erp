-- =====================================================================
-- V58 — Cheque deposit account, bounce reason, re-presenting.
--  * Bank ledgers live under a "Bank Accounts" head; a posted cheque
--    records which one it was deposited to (bounce reverses that one).
--  * Bounces carry a reason (INSUFFICIENT_FUNDS / SIGNATURE_MISMATCH / OTHER).
--  * A bounced cheque can be RESUBMITTED (back to PENDING).
-- =====================================================================

INSERT INTO account_group (code, name, name_bn, nature, parent_id, is_system)
SELECT 'A-BK', 'Bank Accounts', 'ব্যাংক হিসাব', 'ASSET', id, true
FROM account_group WHERE code = 'A-CA'
ON CONFLICT (code) DO NOTHING;

UPDATE account SET group_id = (SELECT id FROM account_group WHERE code = 'A-BK')
WHERE code = '1010';

ALTER TABLE cheque ADD COLUMN deposit_account VARCHAR(20);
UPDATE cheque SET deposit_account = '1010' WHERE status = 'POSTED';

ALTER TABLE cheque_event ADD COLUMN reason VARCHAR(30);
ALTER TABLE cheque_event DROP CONSTRAINT chk_cheque_event_type;
ALTER TABLE cheque_event ADD CONSTRAINT chk_cheque_event_type CHECK (event_type IN
    ('RECEIVED','DATE_CHANGED','HOLD','RESUMED','CASHED','POSTED','BOUNCED','EDITED','CANCELLED','RESUBMITTED'));
