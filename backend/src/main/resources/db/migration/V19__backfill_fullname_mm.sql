-- Re-generate fullName for BOARD products: replace leading thickness number with <thickness>MM
UPDATE product
SET full_name = REGEXP_REPLACE(full_name, '^(\d+(\.\d+)?)-', '\1MM-')
WHERE type = 'BOARD'
  AND thickness_mm IS NOT NULL
  AND full_name IS NOT NULL
  AND full_name NOT LIKE '%MM-%';
