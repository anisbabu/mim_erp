-- =====================================================================
-- V22 — Attribute sales orders and delivery challans to a salesperson.
-- Auto-set to the logged-in user when they are a SALESPERSON; otherwise
-- (MANAGER/ADMIN raising on someone's behalf) chosen explicitly in the UI.
-- =====================================================================

ALTER TABLE sales_order      ADD COLUMN salesperson_id UUID REFERENCES app_user(id);
ALTER TABLE delivery_challan ADD COLUMN salesperson_id UUID REFERENCES app_user(id);
