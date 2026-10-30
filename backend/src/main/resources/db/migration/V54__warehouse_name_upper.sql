-- Warehouse names are stored in upper case.
UPDATE warehouse SET name = upper(trim(name)) WHERE name <> upper(trim(name));
