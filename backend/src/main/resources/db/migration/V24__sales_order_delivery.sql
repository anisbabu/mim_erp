-- =====================================================================
-- V24 — Optional per-order delivery override. When a sale ships
-- somewhere other than the customer's own address, staff can record it
-- here without touching the customer's master record.
-- =====================================================================

ALTER TABLE sales_order ADD COLUMN delivery_address VARCHAR(400);
ALTER TABLE sales_order ADD COLUMN delivery_mobile  VARCHAR(40);
