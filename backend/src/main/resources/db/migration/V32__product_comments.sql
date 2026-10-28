ALTER TABLE product ADD COLUMN comments VARCHAR(255);

-- keep the full size text where the thickness number alone is ambiguous
UPDATE product SET comments = '19MMX1MM' WHERE name ILIKE '%EDGING 19MMX1MM%';
UPDATE product SET comments = '1MMX38MM' WHERE name ILIKE '%EDGING 1MMX38MM%';
UPDATE product SET comments = '22MMX1MM' WHERE name ILIKE '%EDGING 22MMX1MM%';
UPDATE product SET comments = '2/3MM'    WHERE name ILIKE '2/3MM %';
UPDATE product SET comments = 'Door (7.0X2.5)X38mmX6"' WHERE name ILIKE 'Door (7.0X2.5)X38mmX6"%';
