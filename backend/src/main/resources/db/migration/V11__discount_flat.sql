-- Replace % discount with flat gross amount; add discount authoriser fields.
ALTER TABLE so_line  RENAME COLUMN discount_pct TO discount_amt;
ALTER TABLE so_line  ALTER  COLUMN discount_amt TYPE NUMERIC(15,2);
ALTER TABLE dc_line  RENAME COLUMN discount_pct TO discount_amt;
ALTER TABLE dc_line  ALTER  COLUMN discount_amt TYPE NUMERIC(15,2);

ALTER TABLE sales_order      ADD COLUMN discount_by VARCHAR(255);
ALTER TABLE delivery_challan ADD COLUMN discount_by VARCHAR(255);