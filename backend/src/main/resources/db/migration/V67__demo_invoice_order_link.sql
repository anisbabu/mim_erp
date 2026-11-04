-- Which sales order a demo invoice was turned into
ALTER TABLE demo_invoice ADD COLUMN IF NOT EXISTS so_id uuid;
ALTER TABLE demo_invoice ADD COLUMN IF NOT EXISTS so_no varchar(32);
