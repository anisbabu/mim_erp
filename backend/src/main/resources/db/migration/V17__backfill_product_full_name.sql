UPDATE product p
SET full_name = CONCAT_WS('-',
    CASE WHEN p.thickness_mm IS NOT NULL THEN TRIM(TO_CHAR(p.thickness_mm, 'FM999990.999')) ELSE NULL END,
    NULLIF(TRIM(p.name), ''),
    NULLIF(TRIM(p.category), ''),
    NULLIF(TRIM(p.color), ''),
    CASE WHEN p.supplier_id IS NOT NULL THEN
        '(' || (SELECT SPLIT_PART(TRIM(s.name), ' ', 1) FROM supplier s WHERE s.id = p.supplier_id) || ')'
    ELSE NULL END
)
WHERE p.type = 'BOARD' AND (p.full_name IS NULL OR p.full_name = '');

UPDATE product SET full_name = TRIM(name)
WHERE type = 'HARDWARE' AND (full_name IS NULL OR full_name = '');