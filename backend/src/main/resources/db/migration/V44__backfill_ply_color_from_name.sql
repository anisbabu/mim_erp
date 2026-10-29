-- PLY: colour is what is left after dropping thickness, (CLOSE), DAMAGE, PLY/PLYWOOD, B/S, O/S
-- and the trailing (SUPPLIER), e.g. "15MM GARGON PLYWOOD" -> "GARGON".
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '^[0-9.]+MM\s+', ''),
               '(\(CLOSE\)|\mDAMAGE\M|\mPLY(WOOD)?\M|\m[BO]/S\M)', ' ', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'PLY'
      AND (color IS NULL OR TRIM(color) = '')
      AND UPPER(name) ~ '^[0-9.]+MM\s'
) t
WHERE p.id = t.id
  AND t.c <> '';
