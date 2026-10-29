-- EDGING: colour is what is left after dropping (CLOSE), DAMAGE, EDGING, ELEGANT, the size
-- (0.5X19, -.8X22, 19MMX1MM, 38MM) and the trailing (SUPPLIER),
-- e.g. "EDGING BURMA TEAK 1X22 (AHMED)" -> "BURMA TEAK", "EDGING 3502-.8X22 (AMERICANO)" -> "3502".
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           SUBSTRING(UPPER(name) FROM '\(([^()]*)\)?\s*$') AS supplier,
           TRIM(BOTH ' -' FROM REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '(\(CLOSE\)|\mDAMAGE\M|\mEDGING\M|\mELEGANT\M)', ' ', 'g'),
               '[- ]*([0-9]*\.?[0-9]+(MM)?X[0-9]+(MM)?|\m[0-9]+MM\M)', ' ', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'EDGING'
      AND (color IS NULL OR TRIM(color) = '')
      AND UPPER(name) NOT LIKE '%ALUMINIUM%'
) t
WHERE p.id = t.id
  AND t.c <> ''
  AND t.c IS DISTINCT FROM TRIM(t.supplier);

-- Aluminium edging: colour is the finish inside the brackets, e.g. "(T BLACK)" -> "BLACK".
UPDATE product
SET color = CASE m[1] WHEN 'CP DEEP' THEN 'DEEP CP' ELSE m[1] END
FROM (SELECT id AS mid, REGEXP_MATCH(UPPER(name), '(DEEP CP|CP DEEP|BLACK|GOLDEN|SHAMPAIN|SILVER)') AS m
      FROM product
      WHERE category = 'EDGING' AND UPPER(name) LIKE '%ALUMINIUM%'
        AND (color IS NULL OR TRIM(color) = '')) x
WHERE id = x.mid AND m IS NOT NULL;
