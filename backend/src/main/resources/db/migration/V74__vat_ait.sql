-- VAT (prices include VAT) and tax deducted at source (AIT / VDS) on vouchers.
-- VAT stays off until switched on in Tax settings, so nothing posts differently until then.

INSERT INTO app_setting (key, value) VALUES
    ('vat_enabled', 'false'),
    ('vat_default_rate', '5')
ON CONFLICT (key) DO NOTHING;

-- product.tax_rate (already present, unused until now) is the product's VAT rate; NULL = the default rate

-- the rate captured on each sold line, so returns reverse exactly what was charged
ALTER TABLE so_line ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE dc_line ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

-- input VAT shown on the supplier's VAT invoice (Mushak 6.3), included in the billed prices
ALTER TABLE goods_receipt ADD COLUMN IF NOT EXISTS vat NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vat >= 0);
ALTER TABLE purchase_return ADD COLUMN IF NOT EXISTS vat NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_return ADD COLUMN IF NOT EXISTS vat NUMERIC(14,2) NOT NULL DEFAULT 0;

-- tax deducted at source on a voucher: by us from a supplier, or by a customer from us
ALTER TABLE payment
    ADD COLUMN IF NOT EXISTS ait NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (ait >= 0),
    ADD COLUMN IF NOT EXISTS vds NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vds >= 0);

INSERT INTO account (code, name, name_bn, type, group_id, is_system)
SELECT '2110', 'VDS Payable', 'উৎসে কর্তিত ভ্যাট প্রদেয়', 'LIABILITY',
       COALESCE((SELECT id FROM account_group WHERE code = 'L-CL'), (SELECT group_id FROM account WHERE code = '2100')), true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE code = '2110');

INSERT INTO account (code, name, name_bn, type, group_id, is_system)
SELECT '1470', 'VDS Credit (deducted by customers)', 'গ্রাহক কর্তৃক উৎসে কর্তিত ভ্যাট', 'ASSET',
       COALESCE((SELECT id FROM account_group WHERE code = 'A-CA'), (SELECT group_id FROM account WHERE code = '1450')), true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE code = '1470');
