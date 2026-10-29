-- Stock group from the old system's "Stock Summary (Group Wise)" report, e.g. A.R HANDLE, Ahmed Melamine.
ALTER TABLE product ADD COLUMN IF NOT EXISTS product_group VARCHAR(100);
