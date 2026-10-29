-- MELAMINE boards: colour is what is left after dropping thickness, (CLOSE), DAMAGE, MELAMINE,
-- B/S, O/S and the trailing (SUPPLIER), e.g. "16MM DAMAGE 750 MELAMINE (SUPER)" -> "750".
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '^[0-9.]+MM\s+', ''),
               '(\(CLOSE\)|\mDAMAGE\M|\mMELAMINE\M|\m[BO]/S\M)', '', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'MELAMINE'
      AND (color IS NULL OR TRIM(color) = '')
      AND UPPER(name) ~ '^[0-9.]+MM\s'
) t
WHERE p.id = t.id
  AND t.c <> '';
