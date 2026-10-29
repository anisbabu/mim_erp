-- HANDLE: colour is the finish left after dropping the (SUPPLIER), size (4", 12''), model number,
-- handle/model words and supplier names, e.g. 4" HANDLE 5252 CF (A.R) -> CF, 10" HANDLE 1588 (RG) -> RG.
-- A trailing bracket is a supplier only when it is a known supplier; otherwise it is the finish.
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\((HI-CARE|J\.M|SAIFUL|MONIR|A\.R|AL-MONSUR|MAMUN BUILDERS|T\.I\.T|SES|EASY|ROLAND|CRYSTAL\s*)\)?\s*$', ''),
               '[()]', ' ', 'g'),
               '^\s*[0-9.]+\s*("|''''|MM)\s*', ''),
               '^.*\m\S*[0-9]\S*', ''),
               '(\m(CLOSE|DAMAGE|HANDLE|HANDEL|DOBA|ROUND|ROD|ROAD|MINAR|DOOR|ALUMINIUM|ALUMINUM|PROFILE|QUVEK|ACR|ATM|YUBA|PATA|PAT|LIN|ITEM|K\.D|KD|BIT|FUN|SCROWE?|L|RAIL|SHEET|JOGUORA|CAMARY|ROLAND|MONIR|NORMAL P|HEAVY H|HI-CLASS)\M|\mHI[- ]CARE\M)', ' ', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'HANDLE'
      AND (color IS NULL OR TRIM(color) = '')
) t
WHERE p.id = t.id
  AND t.c <> '';

-- Second pass: finish written before the model number, e.g. 18" ALUMINIUM HANDLE BLACK 7099 -> BLACK.
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name),
               '\s*\((HI-CARE|J\.M|SAIFUL|MONIR|A\.R|AL-MONSUR|MAMUN BUILDERS|T\.I\.T|SES|EASY|ROLAND|CRYSTAL\s*)\)?\s*$', ''),
               '[()]', ' ', 'g'),
               '\m\S*[0-9]\S*', ' ', 'g'),
               '(\m(CLOSE|DAMAGE|HANDLE|HANDEL|DOBA|ROUND|ROD|ROAD|MINAR|DOOR|ALUMINIUM|ALUMINUM|PROFILE|QUVEK|ACR|ATM|YUBA|PATA|PAT|LIN|ITEM|K\.D|KD|BIT|FUN|SCROWE?|L|RAIL|SHEET|JOGUORA|CAMARY|ROLAND|MONIR|NORMAL P|HEAVY H|HI-CLASS)\M|\mHI[- ]CARE\M)', ' ', 'g'),
               '\s+', ' ', 'g')) AS c
    FROM product
    WHERE category = 'HANDLE'
      AND (color IS NULL OR TRIM(color) = '')
) t
WHERE p.id = t.id
  AND t.c <> '';
