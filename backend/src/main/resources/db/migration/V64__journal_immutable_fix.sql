-- V64 - the immutability trigger must not touch NEW.* on tables / operations where it does not exist
CREATE OR REPLACE FUNCTION trg_journal_immutable() RETURNS trigger AS $$
BEGIN
    IF current_setting('mim.allow_journal_change', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'journal_entry' AND TG_OP = 'UPDATE' THEN
        -- the only permitted change on a posted entry: linking it to its reversing entry
        IF NEW.reversed_by IS DISTINCT FROM OLD.reversed_by
           AND (NEW.id, NEW.entry_no, NEW.entry_date, NEW.narration, NEW.source_type, NEW.source_id,
                NEW.created_at, NEW.created_by, NEW.reversal_of)
               IS NOT DISTINCT FROM
               (OLD.id, OLD.entry_no, OLD.entry_date, OLD.narration, OLD.source_type, OLD.source_id,
                OLD.created_at, OLD.created_by, OLD.reversal_of) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'Posted journal entries cannot be changed or deleted - post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;
