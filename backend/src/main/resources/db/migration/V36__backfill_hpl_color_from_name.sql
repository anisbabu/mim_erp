-- HPL: colour is the shade code left after dropping thickness, HPL/SHEET/PLY words and the (SUPPLIER),
-- e.g. "18MM HPL 102 PLY (SUPER)" -> "102", "HPL SHEET 103-GLOSSY (SUPER)" -> "103-GLOSSY".
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(BOTH ' -' FROM REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '^[0-9.]+MM\s+', ''),
               '\m(HPL|SHEET|PLY)\M', '', 'g')) AS c
    FROM product
    WHERE category = 'HPL'
      AND (color IS NULL OR TRIM(color) = '')
) t
WHERE p.id = t.id
  AND t.c ~ '^[0-9]';
