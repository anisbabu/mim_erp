-- =====================================================================
-- V6 — Employees / staff with salary profile.
-- Foundation for payroll: attendance, overtime, advances post against this.
-- =====================================================================

CREATE TABLE employee (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(30)  NOT NULL UNIQUE,
    name            VARCHAR(160) NOT NULL,
    name_bn         VARCHAR(200),
    designation     VARCHAR(120),
    designation_bn  VARCHAR(200),
    shop_id         UUID REFERENCES shop(id),     -- staff belong to a shop
    mobile          VARCHAR(30),
    address         VARCHAR(255),
    joining_date    DATE,
    -- salary structure
    salary_type     VARCHAR(20)  NOT NULL DEFAULT 'MONTHLY',  -- MONTHLY | DAILY
    basic_salary    NUMERIC(16,2) NOT NULL DEFAULT 0,         -- monthly basic, or daily wage rate
    house_rent      NUMERIC(16,2) NOT NULL DEFAULT 0,
    medical         NUMERIC(16,2) NOT NULL DEFAULT 0,
    transport       NUMERIC(16,2) NOT NULL DEFAULT 0,
    other_allowance NUMERIC(16,2) NOT NULL DEFAULT 0,
    overtime_rate   NUMERIC(16,2) NOT NULL DEFAULT 0,         -- per hour
    active          BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_emp_salary_type CHECK (salary_type IN ('MONTHLY','DAILY'))
);
CREATE INDEX idx_employee_shop ON employee(shop_id);

CREATE TRIGGER t_emp BEFORE UPDATE ON employee FOR EACH ROW EXECUTE FUNCTION set_updated_at();
