-- =====================================================================
-- V59 — Default deposit bank. One ledger under Bank Accounts can be the
-- default a cheque is posted to (listed first in the picker).
-- =====================================================================

ALTER TABLE account ADD COLUMN default_deposit BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX uq_account_default_deposit ON account (default_deposit) WHERE default_deposit;

-- DBBL when it exists, otherwise the generic Bank ledger
UPDATE account SET default_deposit = true
WHERE code = COALESCE((SELECT code FROM account WHERE code = '1011' AND name = 'DBBL'), '1010');
