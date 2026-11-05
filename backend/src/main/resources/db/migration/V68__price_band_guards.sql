-- Price band hardening: sane band, audit of band edits, override recorded on challan lines.

ALTER TABLE product
    ADD CONSTRAINT product_price_band_chk
    CHECK (price_lower IS NULL OR price_upper IS NULL OR price_lower <= price_upper);

CREATE TABLE product_price_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    old_lower   NUMERIC(16,2),
    old_upper   NUMERIC(16,2),
    new_lower   NUMERIC(16,2),
    new_upper   NUMERIC(16,2),
    changed_by  VARCHAR(120),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_price_audit_product ON product_price_audit(product_id, changed_at DESC);

ALTER TABLE dc_line ADD COLUMN price_override_by VARCHAR(120);  -- audit: who authorised out-of-band price

-- SO lines used to carry the override name on every line; keep it only where the price really was out of band.
UPDATE so_line sl SET price_override_by = NULL
FROM product p
WHERE p.id = sl.product_id
  AND sl.price_override_by IS NOT NULL
  AND (p.price_lower IS NULL OR sl.unit_price >= p.price_lower)
  AND (p.price_upper IS NULL OR sl.unit_price <= p.price_upper);
