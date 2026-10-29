-- Normalise free-text product fields to upper case (names/full names already are).
UPDATE product SET product_group = UPPER(product_group) WHERE product_group <> UPPER(product_group);
UPDATE product SET color         = UPPER(color)         WHERE color         <> UPPER(color);
UPDATE product SET comments      = UPPER(comments)      WHERE comments      <> UPPER(comments);
