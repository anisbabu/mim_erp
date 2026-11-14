-- Clearer P&L: trade discount and transport recovered get their own ledgers; bank charges on a bounced cheque.

INSERT INTO account (code, name, name_bn, type, group_id, is_system)
SELECT '4010', 'Sales Discount', 'বিক্রয় বাট্টা', 'INCOME', (SELECT group_id FROM account WHERE code = '4000'), true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE code = '4010');

INSERT INTO account (code, name, name_bn, type, group_id, is_system)
SELECT '4400', 'Transport & Lifting Recovered', 'আদায়কৃত পরিবহন ও লোডিং', 'INCOME', (SELECT group_id FROM account WHERE code = '4000'), true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE code = '4400');

INSERT INTO account (code, name, name_bn, type, group_id, is_system)
SELECT '5600', 'Bank Charges', 'ব্যাংক চার্জ', 'EXPENSE',
       COALESCE((SELECT id FROM account_group WHERE code = 'X-OE'), (SELECT group_id FROM account WHERE code = '5200')), true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE code = '5600');

-- bank's charge on a bounced cheque, and whether the customer bears it
ALTER TABLE cheque
    ADD COLUMN IF NOT EXISTS bounce_charge NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (bounce_charge >= 0),
    ADD COLUMN IF NOT EXISTS bounce_charge_to_customer BOOLEAN NOT NULL DEFAULT FALSE;
