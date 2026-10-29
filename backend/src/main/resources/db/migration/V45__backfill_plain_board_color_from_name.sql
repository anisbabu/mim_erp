-- PLAIN BOARD: colour is what is left after dropping thickness, (CLOSE), DAMAGE, PLAIN BOARD,
-- grade (A)/(B)/B, sheet size (8X4) and the (SUPPLIER), e.g. "12MM WOODTEX PLAIN BOARD (AKIJ)" -> "WOODTEX",
-- "12MM PLAIN BOARD (POLAR)(STAR PARTEX)" -> "POLAR". Bare plain boards have no colour and are skipped.
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '^[0-9.]+MM\s+', ''),
               '(\(CLOSE\)|\mDAMAGE\M|\mPLAIN BOARD\M|\(?\m[AB]\M\)?|\m[0-9]+X[0-9]+\M|[()])', ' ', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'PLAIN BOARD'
      AND (color IS NULL OR TRIM(color) = '')
      AND UPPER(name) ~ '^[0-9.]+MM\s'
) t
WHERE p.id = t.id
  AND t.c <> '';
