-- =====================================================================
-- V60 — WhatsApp maturity reminder (sent the day before a cheque matures).
-- reminder_for_date = the maturity date the last reminder was made for, so a
-- changed maturity date automatically re-arms the reminder.
-- =====================================================================

ALTER TABLE cheque ADD COLUMN reminder_for_date DATE;
ALTER TABLE cheque ADD COLUMN reminder_sent_at  TIMESTAMPTZ;
ALTER TABLE cheque ADD COLUMN reminder_status   VARCHAR(20);   -- SENT | FAILED | SKIPPED
ALTER TABLE cheque ADD COLUMN reminder_error    VARCHAR(255);

CREATE TABLE app_setting (
    key   VARCHAR(60) PRIMARY KEY,
    value VARCHAR(255) NOT NULL
);

INSERT INTO app_setting (key, value) VALUES
    ('cheque_reminder_enabled', 'true'),
    ('cheque_reminder_lang', 'bn');
