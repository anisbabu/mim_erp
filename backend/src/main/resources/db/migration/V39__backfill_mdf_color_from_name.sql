-- MDF boards: colour is what is left after dropping thickness, DAMAGE, MDF, MLB, LEMINATION,
-- sheet size (8X4) and the trailing (SUPPLIER), e.g. "15MM MDF MLB 750 (SUPER)" -> "750".
-- PLAIN (unlaminated) boards have no colour and are skipped.
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\([^()]*\)?\s*$', ''),
               '^[0-9./]+MM\s+', ''),
               '(\mDAMAGE\M|\mMDF\M|\mMLB\M|\mLEMINATION\M|\m[0-9]+X[0-9]+\M|[()])', ' ', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'MDF'
      AND (color IS NULL OR TRIM(color) = '')
      AND UPPER(name) ~ '^[0-9./]+MM\s'
) t
WHERE p.id = t.id
  AND t.c <> ''
  AND t.c !~ '^PLAIN\M';
