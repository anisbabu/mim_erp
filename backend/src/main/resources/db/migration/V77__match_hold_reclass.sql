-- An item the user unmatched by hand is kept out of automatic (oldest-first) matching until matched by hand.
ALTER TABLE party_item ADD COLUMN IF NOT EXISTS hold_auto BOOLEAN NOT NULL DEFAULT FALSE;
