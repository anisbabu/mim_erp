-- WPC: colour is what is left after dropping thickness, DAMAGE, WPC and the trailing (SUPPLIER),
-- e.g. "18MM WPC HOTSTAMPING 1 (N. POLY)" -> "HOTSTAMPING 1".
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '^[0-9.]+MM\s+', ''),
               '(\mDAMAGE\M|\mWPC\M)', ' ', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'WPC'
      AND (color IS NULL OR TRIM(color) = '')
) t
WHERE p.id = t.id
  AND t.c <> '';
