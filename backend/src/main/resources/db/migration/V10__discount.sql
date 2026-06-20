-- Line-level discount percentage (0 = no discount). unitPrice on dc_line/so_line stores net (after-discount) price.
ALTER TABLE so_line ADD COLUMN discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE dc_line ADD COLUMN discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;