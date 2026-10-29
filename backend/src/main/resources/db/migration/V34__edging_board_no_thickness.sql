-- EDGING products are BOARD but are sized by edging_size (e.g. 1X22), so they need no thickness_mm.
ALTER TABLE product DROP CONSTRAINT IF EXISTS chk_board_thickness;
ALTER TABLE product ADD CONSTRAINT chk_board_thickness
    CHECK (type <> 'BOARD' OR thickness_mm IS NOT NULL OR category = 'EDGING');
