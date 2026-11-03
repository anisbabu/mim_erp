-- =====================================================================
-- V63 - Accounting controls: year close, immutable journal, reversals,
--       gapless voucher numbers, bank reconciliation, fixed assets,
--       VAT / AIT ledgers, IFRS classification groups.
-- =====================================================================

-- ---- year close bookkeeping
ALTER TABLE financial_year ADD COLUMN closed_at TIMESTAMPTZ;
ALTER TABLE financial_year ADD COLUMN closing_entry_id UUID;

-- ---- audit trail + reversal links on journal entries
ALTER TABLE journal_entry ADD COLUMN created_by  VARCHAR(60);
ALTER TABLE journal_entry ADD COLUMN reversal_of UUID REFERENCES journal_entry(id);
ALTER TABLE journal_entry ADD COLUMN reversed_by UUID REFERENCES journal_entry(id);

-- ---- gapless voucher numbers: one counter row per prefix+year, locked inside the posting transaction
CREATE TABLE doc_counter (
    prefix   VARCHAR(20) NOT NULL,
    yr       INT         NOT NULL,
    last_no  BIGINT      NOT NULL,
    PRIMARY KEY (prefix, yr)
);
INSERT INTO doc_counter (prefix, yr, last_no)
SELECT 'JE', split_part(entry_no, '-', 2)::int, MAX(split_part(entry_no, '-', 3)::bigint)
FROM journal_entry WHERE entry_no ~ '^JE-[0-9]{4}-[0-9]+$'
GROUP BY split_part(entry_no, '-', 2);

-- ---- posted journals are immutable (only the reversed_by link may be set; reopening a year
--      switches mim.allow_journal_change on for its own transaction only)
CREATE FUNCTION trg_journal_immutable() RETURNS trigger AS $$
BEGIN
    IF current_setting('mim.allow_journal_change', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'journal_entry' AND TG_OP = 'UPDATE'
       AND NEW.reversed_by IS DISTINCT FROM OLD.reversed_by
       AND (NEW.id, NEW.entry_no, NEW.entry_date, NEW.narration, NEW.source_type, NEW.source_id,
            NEW.created_at, NEW.created_by, NEW.reversal_of)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.entry_no, OLD.entry_date, OLD.narration, OLD.source_type, OLD.source_id,
            OLD.created_at, OLD.created_by, OLD.reversal_of) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted journal entries cannot be changed or deleted - post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_immutable BEFORE UPDATE OR DELETE ON journal_entry
    FOR EACH ROW EXECUTE FUNCTION trg_journal_immutable();
CREATE TRIGGER journal_line_immutable BEFORE UPDATE OR DELETE ON journal_line
    FOR EACH ROW EXECUTE FUNCTION trg_journal_immutable();

-- ---- debits must equal credits for every journal, enforced by the database at commit
CREATE FUNCTION trg_journal_balanced() RETURNS trigger AS $$
DECLARE jid UUID; dr NUMERIC; cr NUMERIC;
BEGIN
    jid := COALESCE(NEW.journal_id, OLD.journal_id);
    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO dr, cr FROM journal_line WHERE journal_id = jid;
    IF dr <> cr THEN
        RAISE EXCEPTION 'Unbalanced journal %: debit % <> credit %', jid, dr, cr;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_line_balanced AFTER INSERT OR UPDATE ON journal_line
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_journal_balanced();

-- ---- chart additions
INSERT INTO account_group (code, name, name_bn, nature, parent_id, is_system, active)
SELECT 'L-NC', 'Non-current Liabilities', 'দীর্ঘমেয়াদি দায়', 'LIABILITY', p.id, true, true
FROM account_group p WHERE p.code = 'L'
  AND NOT EXISTS (SELECT 1 FROM account_group WHERE code = 'L-NC');

INSERT INTO account (code, name, name_bn, type, group_id, is_system, active)
SELECT v.code, v.name, v.name_bn, v.type, g.id, true, true
FROM (VALUES
  ('3100', 'Retained Earnings',          'সঞ্চিত মুনাফা',              'EQUITY',    'E'),
  ('1500', 'Fixed Assets (at cost)',     'স্থায়ী সম্পদ (ক্রয়মূল্য)',    'ASSET',     'A-FA'),
  ('1590', 'Accumulated Depreciation',   'সঞ্চিত অবচয়',               'ASSET',     'A-FA'),
  ('1450', 'Input VAT Recoverable',      'ইনপুট ভ্যাট (ফেরতযোগ্য)',     'ASSET',     'A-CA'),
  ('1460', 'AIT / Advance Tax Paid',     'অগ্রিম আয়কর',               'ASSET',     'A-CA'),
  ('2100', 'Output VAT Payable',         'আউটপুট ভ্যাট (প্রদেয়)',       'LIABILITY', 'L-CL'),
  ('2120', 'AIT / TDS Payable',          'উৎসে কর্তিত কর (প্রদেয়)',     'LIABILITY', 'L-CL'),
  ('2500', 'Long-term Loans',            'দীর্ঘমেয়াদি ঋণ',             'LIABILITY', 'L-NC'),
  ('4100', 'Gain on Disposal of Assets', 'সম্পদ বিক্রয়ে লাভ',          'INCOME',    'I'),
  ('5400', 'Depreciation Expense',       'অবচয় ব্যয়',                 'EXPENSE',   'X-ID'),
  ('5900', 'Loss on Disposal of Assets', 'সম্পদ বিক্রয়ে ক্ষতি',         'EXPENSE',   'X-ID')
) AS v(code, name, name_bn, type, grp)
JOIN account_group g ON g.code = v.grp
WHERE NOT EXISTS (SELECT 1 FROM account a WHERE a.code = v.code);

-- ---- bank reconciliation: journal lines cleared against a bank statement
CREATE TABLE bank_reconciliation (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        UUID NOT NULL REFERENCES account(id),
    statement_date    DATE NOT NULL,
    statement_balance NUMERIC(16,2) NOT NULL,
    book_balance      NUMERIC(16,2) NOT NULL,
    note              VARCHAR(255),
    created_by        VARCHAR(60),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bank_reconciled_line (
    journal_line_id   UUID PRIMARY KEY REFERENCES journal_line(id),
    reconciliation_id UUID NOT NULL REFERENCES bank_reconciliation(id) ON DELETE CASCADE
);
CREATE INDEX idx_bank_recon_acct ON bank_reconciliation(account_id, statement_date);

-- ---- fixed asset register (IAS 16, straight-line)
CREATE TABLE fixed_asset (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code               VARCHAR(30)   NOT NULL UNIQUE,
    name               VARCHAR(160)  NOT NULL,
    category           VARCHAR(60),
    purchase_date      DATE          NOT NULL,
    cost               NUMERIC(16,2) NOT NULL CHECK (cost > 0),
    residual_value     NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
    useful_life_months INT           NOT NULL CHECK (useful_life_months > 0),
    status             VARCHAR(12)   NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | DISPOSED
    disposal_date      DATE,
    disposal_proceeds  NUMERIC(16,2),
    note               VARCHAR(255),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_fa_residual CHECK (residual_value < cost)
);
CREATE TABLE fixed_asset_depreciation (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id   UUID          NOT NULL REFERENCES fixed_asset(id),
    period     CHAR(7)       NOT NULL,                       -- yyyy-mm
    amount     NUMERIC(16,2) NOT NULL,
    journal_id UUID REFERENCES journal_entry(id),
    UNIQUE (asset_id, period)
);
