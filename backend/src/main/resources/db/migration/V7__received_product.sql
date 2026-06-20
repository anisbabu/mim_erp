-- =====================================================================
-- V7 — Goods receipt may bring in a different product than ordered
-- (same product, different colour = different SKU; or a different
-- product at the same PO price). The receipt line records what actually
-- arrived; price and the ordered line's balance stay tied to the PO line.
-- =====================================================================

ALTER TABLE grn_line ADD COLUMN received_product_id UUID REFERENCES product(id);

-- backfill existing receipts: received product = the ordered product
UPDATE grn_line gl
SET received_product_id = pl.product_id
FROM po_line pl
WHERE pl.id = gl.po_line_id AND gl.received_product_id IS NULL;
