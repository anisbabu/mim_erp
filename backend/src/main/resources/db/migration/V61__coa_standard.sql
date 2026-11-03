-- =====================================================================
-- V61 — Standard chart of accounts: description on groups and ledgers,
-- and an active flag on groups (deactivate instead of delete).
-- =====================================================================

ALTER TABLE account       ADD COLUMN description VARCHAR(255);
ALTER TABLE account_group ADD COLUMN description VARCHAR(255);
ALTER TABLE account_group ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
