-- display text for thicknesses a number can't express (2/3, 3/4, 19X1); thickness_mm keeps the numeric value
ALTER TABLE product ADD COLUMN thickness_label VARCHAR(20);

UPDATE product SET thickness_label = '2/3'  WHERE name ILIKE '2/3MM %';
UPDATE product SET thickness_label = '3/4'  WHERE name LIKE '3/4" %';
UPDATE product SET thickness_label = '19X1' WHERE name ILIKE '%EDGING 19MMX1MM%';
UPDATE product SET thickness_label = '1X38' WHERE name ILIKE '%EDGING 1MMX38MM%';
UPDATE product SET thickness_label = '22X1' WHERE name ILIKE '%EDGING 22MMX1MM%';
