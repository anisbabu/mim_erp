-- Suppliers can have up to three contact numbers.
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS mobile2 VARCHAR(30);
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS mobile3 VARCHAR(30);
