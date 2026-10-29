-- PVC boards (name starts with thickness): colour is what is left after dropping thickness,
-- (CLOSE), DAMAGE, PVC, B/S, O/S and the trailing (SUPPLIER),
-- e.g. "18MM DAMAGE PVC CD- 04 (AMBER)" -> "CD- 04", "18MM PVC 320 (SUPER)" -> "320".
-- Doors, chaka, fittings etc. are left alone.
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '^[0-9.]+MM\s+', ''),
               '(\(CLOSE\)|\mDAMAGE\M|\mPVC\M|\m[BO]/S\M)', '', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'PVC'
      AND (color IS NULL OR TRIM(color) = '')
      AND UPPER(name) ~ '^[0-9.]+MM\s'
) t
WHERE p.id = t.id
  AND t.c <> ''
  AND t.c <> 'DELETE';
