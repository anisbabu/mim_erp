-- =====================================================================
-- V4 — Users, roles, and shop assignment
-- Salesperson -> exactly 1 shop; Manager -> many shops;
-- Admin / Accountant -> no binding (company-wide).
-- The initial admin is created at app startup if no admin exists.
-- =====================================================================

CREATE TABLE app_user (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(60)  NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    full_name     VARCHAR(120),
    role          VARCHAR(20)  NOT NULL,    -- SALESPERSON | MANAGER | ACCOUNTANT | ADMIN
    active        BOOLEAN      NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_user_role CHECK (role IN ('SALESPERSON','MANAGER','ACCOUNTANT','ADMIN'))
);

-- Shops a user is assigned to (0 rows = company-wide for ADMIN/ACCOUNTANT).
CREATE TABLE user_shop (
    user_id  UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    shop_id  UUID NOT NULL REFERENCES shop(id),
    PRIMARY KEY (user_id, shop_id)
);
CREATE INDEX idx_user_shop_user ON user_shop(user_id);

CREATE TRIGGER t_user BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION set_updated_at();
