-- =====================================================================
-- V71 - Party vouchers: receipt (RV) / payment (PV) voucher numbers,
--       back-dated vouchers, discount allowed / received, and the party
--       + reference stamped on every journal line.
-- =====================================================================

-- ---- journal lines carry the party and the document reference
ALTER TABLE journal_line ADD COLUMN party_type VARCHAR(20);
ALTER TABLE journal_line ADD COLUMN party_id   UUID;
ALTER TABLE journal_line ADD COLUMN ref_no     VARCHAR(60);
ALTER TABLE journal_line ADD COLUMN narration  VARCHAR(255);
CREATE INDEX idx_journal_line_party ON journal_line(party_type, party_id);

-- backfill the party from the ledger the line was posted to (lines are immutable; open them for this one change)
SET LOCAL mim.allow_journal_change = 'on';
UPDATE journal_line jl SET party_type = a.party_type, party_id = a.party_id
FROM account a WHERE a.id = jl.account_id AND a.party_type IS NOT NULL;
SET LOCAL mim.allow_journal_change = 'off';

-- ---- receipt / payment voucher
ALTER TABLE payment ADD COLUMN voucher_no VARCHAR(30);
ALTER TABLE payment ADD COLUMN discount   NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (discount >= 0);
ALTER TABLE payment ADD COLUMN reference  VARCHAR(60);
UPDATE payment SET voucher_no = payment_no WHERE voucher_no IS NULL;
CREATE UNIQUE INDEX uq_payment_voucher_no ON payment(voucher_no);

-- ---- discount ledgers
INSERT INTO account (code, name, name_bn, type, group_id, is_system)
SELECT '5500', 'Discount Allowed', 'প্রদত্ত বাট্টা', 'EXPENSE',
       COALESCE((SELECT id FROM account_group WHERE code = 'X-DSC'), (SELECT id FROM account_group WHERE code = 'X-ID')), true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE code = '5500');

INSERT INTO account (code, name, name_bn, type, group_id, is_system)
SELECT '4300', 'Discount Received', 'প্রাপ্ত বাট্টা', 'INCOME',
       COALESCE((SELECT id FROM account_group WHERE code = 'I-IND'), (SELECT id FROM account_group WHERE code = 'I')), true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE code = '4300');
