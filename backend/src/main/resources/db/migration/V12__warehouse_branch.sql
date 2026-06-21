ALTER TABLE warehouse RENAME COLUMN address TO branch;
ALTER TABLE warehouse ADD COLUMN address VARCHAR(255);