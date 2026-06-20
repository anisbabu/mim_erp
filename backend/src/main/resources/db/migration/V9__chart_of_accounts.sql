-- =====================================================================
-- V9 — Professional accounting layer
--   * account_group : hierarchical heads (Assets > Current Assets, …) with a nature
--   * account       : becomes the LEDGER (postable), linked to a group; may be a
--                     subsidiary ledger for a supplier / customer
--   * financial_year: fiscal year with opening/closing
--   * opening_balance: per ledger per year (this year's opening = last year's closing)
-- =====================================================================

CREATE TABLE account_group (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(20)  NOT NULL UNIQUE,
    name        VARCHAR(160) NOT NULL,
    name_bn     VARCHAR(200),
    nature      VARCHAR(20)  NOT NULL,     -- ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
    parent_id   UUID REFERENCES account_group(id),
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_group_nature CHECK (nature IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'))
);

-- account = ledger (postable account)
ALTER TABLE account ADD COLUMN group_id   UUID REFERENCES account_group(id);
ALTER TABLE account ADD COLUMN party_type VARCHAR(20);   -- SUPPLIER | CUSTOMER (subsidiary ledger)
ALTER TABLE account ADD COLUMN party_id   UUID;
ALTER TABLE account ADD COLUMN active     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE account ADD COLUMN is_system  BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_account_party ON account(party_type, party_id);
CREATE INDEX idx_account_group ON account(group_id);

CREATE TABLE financial_year (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(40) NOT NULL UNIQUE,        -- e.g. 2025-2026
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    status      VARCHAR(10) NOT NULL DEFAULT 'OPEN',  -- OPEN | CLOSED
    is_current  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_fy_status CHECK (status IN ('OPEN','CLOSED'))
);

CREATE TABLE opening_balance (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_year_id UUID NOT NULL REFERENCES financial_year(id) ON DELETE CASCADE,
    account_id        UUID NOT NULL REFERENCES account(id),
    debit             NUMERIC(16,2) NOT NULL DEFAULT 0,
    credit            NUMERIC(16,2) NOT NULL DEFAULT 0,
    UNIQUE (financial_year_id, account_id)
);

-- ---- standard chart of accounts: groups ----
INSERT INTO account_group (code, name, name_bn, nature, parent_id, is_system) VALUES
 ('A',    'Assets',               'সম্পদ',            'ASSET',     NULL, true),
 ('L',    'Liabilities',          'দায়',             'LIABILITY', NULL, true),
 ('E',    'Equity',               'মূলধন',           'EQUITY',    NULL, true),
 ('I',    'Income',               'আয়',              'INCOME',    NULL, true),
 ('X',    'Expenses',             'ব্যয়',            'EXPENSE',   NULL, true);

INSERT INTO account_group (code, name, name_bn, nature, parent_id, is_system) VALUES
 ('A-CA', 'Current Assets',       'চলতি সম্পদ',       'ASSET',     (SELECT id FROM account_group WHERE code='A'), true),
 ('A-FA', 'Fixed Assets',         'স্থায়ী সম্পদ',     'ASSET',     (SELECT id FROM account_group WHERE code='A'), true),
 ('L-CL', 'Current Liabilities',  'চলতি দায়',        'LIABILITY', (SELECT id FROM account_group WHERE code='L'), true),
 ('X-DC', 'Direct Costs',         'প্রত্যক্ষ ব্যয়',   'EXPENSE',   (SELECT id FROM account_group WHERE code='X'), true),
 ('X-ID', 'Indirect Expenses',    'পরোক্ষ ব্যয়',     'EXPENSE',   (SELECT id FROM account_group WHERE code='X'), true);

INSERT INTO account_group (code, name, name_bn, nature, parent_id, is_system) VALUES
 ('SD',   'Sundry Debtors',       'বিবিধ দেনাদার',    'ASSET',     (SELECT id FROM account_group WHERE code='A-CA'), true),
 ('SC',   'Sundry Creditors',     'বিবিধ পাওনাদার',   'LIABILITY', (SELECT id FROM account_group WHERE code='L-CL'), true);

-- ---- map existing seeded ledgers to groups, mark as system ----
UPDATE account SET is_system = true,
  group_id = CASE code
    WHEN '1000' THEN (SELECT id FROM account_group WHERE code='A-CA')   -- Cash
    WHEN '1100' THEN (SELECT id FROM account_group WHERE code='A-CA')   -- A/R control
    WHEN '1200' THEN (SELECT id FROM account_group WHERE code='A-CA')   -- Inventory
    WHEN '1300' THEN (SELECT id FROM account_group WHERE code='A-CA')   -- Petty Cash
    WHEN '2000' THEN (SELECT id FROM account_group WHERE code='L-CL')   -- A/P control
    WHEN '3000' THEN (SELECT id FROM account_group WHERE code='E')      -- Owner Equity
    WHEN '4000' THEN (SELECT id FROM account_group WHERE code='I')      -- Sales Revenue
    WHEN '5000' THEN (SELECT id FROM account_group WHERE code='X-DC')   -- COGS
    WHEN '5100' THEN (SELECT id FROM account_group WHERE code='X-DC')   -- Inventory Loss
    WHEN '5200' THEN (SELECT id FROM account_group WHERE code='X-ID')   -- Shop Expenses
  END;

-- ---- additional standard ledgers (banking + payroll) ----
INSERT INTO account (code, name, name_bn, type, group_id, is_system) VALUES
 ('1010','Bank','ব্যাংক','ASSET',                       (SELECT id FROM account_group WHERE code='A-CA'), true),
 ('1400','Advance to Employees','কর্মচারী অগ্রিম','ASSET',(SELECT id FROM account_group WHERE code='A-CA'), true),
 ('2200','Salary Payable','বেতন প্রদেয়','LIABILITY',     (SELECT id FROM account_group WHERE code='L-CL'), true),
 ('5300','Salary & Wages','বেতন ও মজুরি','EXPENSE',       (SELECT id FROM account_group WHERE code='X-ID'), true);

-- ---- default financial year (Bangladesh fiscal year: July–June) ----
INSERT INTO financial_year (name, start_date, end_date, is_current) VALUES
 ('2025-2026','2025-07-01','2026-06-30', true);
