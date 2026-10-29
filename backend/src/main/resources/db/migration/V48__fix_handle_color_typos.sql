-- HANDLE colours copied typos from product names; fix the colour only (names unchanged).
UPDATE product p
SET color = m.fixed
FROM (VALUES
    ('BLACK GOLDE',     'BLACK GOLDEN'),
    ('GOLDE BLACK',     'GOLDEN BLACK'),
    ('GOLDEB BLACK',    'GOLDEN BLACK'),
    ('GOLDNE',          'GOLDEN'),
    ('PVD GOLDE',       'PVD GOLD'),
    ('RG ROSE GOLDE',   'RG ROSE GOLD'),
    ('MADT GOLD',       'MATT GOLD'),
    ('CHAMPAGEN',       'CHAMPAGNE'),
    ('DEEP COPPR',      'DEEP COPPER'),
    ('DEEP COPPAR',     'DEEP COPPER'),
    ('RAINBO',          'RAINBOW'),
    ('REMBO',           'RAINBOW'),
    ('SARTIN REMBO',    'SATIN RAINBOW'),
    ('SARTINBLACK',     'SATIN BLACK'),
    ('BLACK/SATING',    'BLACK/SATIN'),
    ('CP/ STATIN',      'CP/SATIN'),
    ('WHAIT CHOCALATE', 'WHITE CHOCOLATE'),
    ('ANTIC',           'ANTIQUE'),
    ('AC ANTIC',        'AC ANTIQUE'),
    ('ANTIC BLACK',     'ANTIQUE BLACK'),
    ('BLACK ANTIC',     'BLACK ANTIQUE'),
    ('BLACK ANTI',      'BLACK ANTIQUE')
) AS m(typo, fixed)
WHERE p.category = 'HANDLE'
  AND p.color = m.typo;
