-- =====================================================================
-- V5 — Bilingual names (English + Bangla) on master entities,
--       and a free-product flag on purchase-order lines.
-- =====================================================================

ALTER TABLE product   ADD COLUMN name_bn VARCHAR(200);
ALTER TABLE shop      ADD COLUMN name_bn VARCHAR(200);
ALTER TABLE warehouse ADD COLUMN name_bn VARCHAR(200);
ALTER TABLE supplier  ADD COLUMN name_bn VARCHAR(200);
ALTER TABLE customer  ADD COLUMN name_bn VARCHAR(200);
ALTER TABLE account   ADD COLUMN name_bn VARCHAR(200);

-- Free / complimentary line: quantity is received and counts toward stock,
-- but carries no unit price (zero cost). Quantity still sums into totals.
ALTER TABLE po_line ADD COLUMN free_product BOOLEAN NOT NULL DEFAULT false;

-- price may be zero for a free line
ALTER TABLE po_line DROP CONSTRAINT IF EXISTS po_line_unit_price_check;
