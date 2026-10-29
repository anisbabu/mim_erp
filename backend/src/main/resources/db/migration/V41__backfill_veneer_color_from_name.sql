-- VENEER / LOOSE VENEER: colour is what is left after dropping thickness, DAMAGE, LOOSE, VENEER,
-- B/S, O/S, sizes (2.5'', (8X4)) and the trailing (SUPPLIER),
-- e.g. "12MM SWICH WELNUT VENEER (SUPER)" -> "SWICH WELNUT", "LOOSE VENEER GARJON 2.5'' (AHMED)" -> "GARJON".
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '^[0-9.]+MM\s+', ''),
               '(\mDAMAGE\M|\mLOOSE\M|\mVENEER\M|\m[BO]/S\M|[0-9.]+''''|\([0-9]+X[0-9]+\))', ' ', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category IN ('VENEER', 'LOOSE VENEER')
      AND (color IS NULL OR TRIM(color) = '')
) t
WHERE p.id = t.id
  AND t.c <> '';
