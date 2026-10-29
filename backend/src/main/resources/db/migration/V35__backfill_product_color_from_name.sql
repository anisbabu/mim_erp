-- FORMICA: colour is the text between the leading "FORMICA" and the trailing "(SUPPLIER)",
-- e.g. "FORMICA 102 GREY- MAT (SUPER)" -> "102 GREY- MAT". A leading DAMAG/DAMAGE marker is dropped.
-- Bare thickness rows (0.5, 0.80MM) are skipped.
UPDATE product p
SET color = t.c
FROM (
    SELECT id,
           TRIM(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(name), '^FORMICA\s+(DAMAGE?\s+)?', ''), '\s*\([^()]*\)?\s*$', '')) AS c
    FROM product
    WHERE category = 'FORMICA'
      AND (color IS NULL OR TRIM(color) = '')
      AND UPPER(name) LIKE 'FORMICA %'
) t
WHERE p.id = t.id
  AND t.c <> ''
  AND t.c !~ '^[0-9]*\.?[0-9]+MM$'
  AND t.c !~ '^[0-9]*\.[0-9]+$';

-- Fill product.color where it is still missing, taking the colour found in name / full_name.
-- Longest colour wins, so "WHITE (103) (0.7) GLOSSY" beats "WHITE" and "GREY MAT" beats "GREY".
UPDATE product p
SET color = m.color
FROM (
    SELECT DISTINCT ON (p2.id) p2.id, c.color
    FROM product p2
    JOIN (VALUES
        ('BURMA APPALE'),
        ('PENCIL TEAK'),
        ('RED OAK'),
        ('WHITE'),
        ('WHITE (103) (0.7) GLOSSY'),
        ('WHITE (103) (0.7) MAT'),
        ('GREY'),
        ('GREY MAT'),
        ('GRAPHITE (111) (0.7) MAT')
    ) AS c(color)
      ON (   UPPER(COALESCE(p2.name, ''))      ~ ('(^|[^A-Z0-9])' || regexp_replace(c.color, '([().])', '\\\1', 'g') || '($|[^A-Z0-9])')
          OR UPPER(COALESCE(p2.full_name, '')) ~ ('(^|[^A-Z0-9])' || regexp_replace(c.color, '([().])', '\\\1', 'g') || '($|[^A-Z0-9])'))
    WHERE p2.color IS NULL OR TRIM(p2.color) = ''
    ORDER BY p2.id, LENGTH(c.color) DESC
) m
WHERE p.id = m.id;
