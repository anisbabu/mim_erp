-- monthly target and petty cash float can never be negative
UPDATE shop SET monthly_target   = 0 WHERE monthly_target   < 0;
UPDATE shop SET petty_cash_float = 0 WHERE petty_cash_float < 0;

ALTER TABLE shop ADD CONSTRAINT chk_shop_monthly_target_nonneg   CHECK (monthly_target   >= 0);
ALTER TABLE shop ADD CONSTRAINT chk_shop_petty_cash_float_nonneg CHECK (petty_cash_float >= 0);
