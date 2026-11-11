-- =====================================================================
-- V70 — Audit log: every create / update / delete on every table, plus
-- sign-in events, in one append-only table.
--
-- Capture is done by a row trigger (audit_row) so that JPA saves, bulk
-- saves, raw JdbcTemplate SQL, cascades, scheduled jobs and direct psql
-- sessions are all covered the same way. The backend tells the database
-- who is acting through session settings (mim.audit_*, set on every
-- connection checkout by AuditDataSource); with nothing set the actor is
-- recorded as "system".
--
-- audit_attach_all() puts the trigger on every table that does not have it
-- yet. It runs here and again on every backend start, so a table added by a
-- later migration is audited without any extra code.
-- =====================================================================

CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    user_id     UUID,                            -- null for system / unknown sign-in
    username    VARCHAR(120) NOT NULL,           -- login name at the time, or 'system'
    user_name   VARCHAR(160) NOT NULL,           -- display name at the time, or 'system'
    user_role   VARCHAR(30)  NOT NULL,           -- role at the time, or 'SYSTEM'
    action      VARCHAR(20)  NOT NULL,           -- create | update | delete | restore | role_change | login | logout | login_failed
    module      VARCHAR(40)  NOT NULL,           -- first path segment under /api, or 'system'
    table_name  VARCHAR(63),
    record_id   VARCHAR(200),                    -- primary key (comma-joined when composite)
    old_values  JSONB,                           -- update: changed fields only; delete: whole row
    new_values  JSONB,                           -- update: changed fields only; create: whole row
    ip_address  VARCHAR(64),
    user_agent  VARCHAR(400)
);

-- filters on the Activity Log screen: date range, user, module, action, record
CREATE INDEX idx_audit_created ON audit_log (created_at DESC, id DESC);
CREATE INDEX idx_audit_user    ON audit_log (user_id, created_at DESC);
CREATE INDEX idx_audit_module  ON audit_log (module, created_at DESC);
CREATE INDEX idx_audit_action  ON audit_log (action, created_at DESC);
CREATE INDEX idx_audit_record  ON audit_log (record_id);
CREATE INDEX idx_audit_table   ON audit_log (table_name, created_at DESC);

-- ---------------------------------------------------------------------
-- Tamper-proofing: entries can be inserted and read, never changed.
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_audit_log_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Audit log entries cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION trg_audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION trg_audit_log_immutable();

-- ---------------------------------------------------------------------
-- Secrets never reach the log: any column whose name looks like a secret is
-- replaced by '***' (so a password change shows as changed, without the value).
-- app_setting rows are key/value, so the value is masked when the key looks secret.
-- ---------------------------------------------------------------------
CREATE FUNCTION audit_mask(j jsonb) RETURNS jsonb AS $$
    SELECT CASE WHEN j IS NULL THEN NULL ELSE coalesce((
        SELECT jsonb_object_agg(e.key,
                   CASE WHEN e.value = 'null'::jsonb THEN e.value
                        WHEN e.key ~* '(password|passwd|secret|token|api_?key|credential|hash)' THEN '"***"'::jsonb
                        WHEN e.key = 'value' AND (j ->> 'key') ~* '(password|passwd|secret|token|api_?key|credential|hash)' THEN '"***"'::jsonb
                        ELSE e.value END)
          FROM jsonb_each(j) e), '{}'::jsonb) END
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------
-- The row trigger. No exception handler on purpose: if the audit entry cannot
-- be written the statement fails and the whole transaction rolls back, so a
-- change can never exist without its log entry.
-- ---------------------------------------------------------------------
CREATE FUNCTION audit_row() RETURNS trigger AS $$
DECLARE
    o     jsonb;
    n     jsonb;
    r     jsonb;      -- the row used to read the primary key
    d_old jsonb;
    d_new jsonb;
    act   text;
    rid   text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        n := to_jsonb(NEW); r := n; act := 'create'; d_new := n;
    ELSIF TG_OP = 'DELETE' THEN
        o := to_jsonb(OLD); r := o; act := 'delete'; d_old := o;
    ELSE
        o := to_jsonb(OLD); n := to_jsonb(NEW); r := n; act := 'update';
        -- changed fields only; updated_at is bookkeeping, not a change
        SELECT jsonb_object_agg(e.key, e.value), jsonb_object_agg(e.key, o -> e.key)
          INTO d_new, d_old
          FROM jsonb_each(n) e
         WHERE e.key <> 'updated_at' AND (o -> e.key) IS DISTINCT FROM e.value;
        IF d_new IS NULL THEN RETURN NULL; END IF;          -- nothing really changed
        -- the app's soft delete is the "active" flag
        IF jsonb_typeof(d_new -> 'active') = 'boolean' THEN
            act := CASE WHEN (d_new ->> 'active')::boolean THEN 'restore' ELSE 'delete' END;
        END IF;
    END IF;

    -- a user's role, or the shops a user may work in
    IF TG_TABLE_NAME = 'user_shop' OR (TG_TABLE_NAME = 'app_user' AND TG_OP = 'UPDATE' AND d_new ? 'role') THEN
        act := 'role_change';
    END IF;

    SELECT string_agg(r ->> a.attname, ',' ORDER BY array_position(i.indkey::int2[], a.attnum))
      INTO rid
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])
     WHERE i.indrelid = TG_RELID AND i.indisprimary;
    IF rid IS NULL THEN rid := r ->> 'id'; END IF;

    INSERT INTO audit_log (user_id, username, user_name, user_role, action, module,
                           table_name, record_id, old_values, new_values, ip_address, user_agent)
    VALUES (nullif(current_setting('mim.audit_user_id', true), '')::uuid,
            coalesce(nullif(current_setting('mim.audit_username', true), ''), 'system'),
            coalesce(nullif(current_setting('mim.audit_user_name', true), ''), 'system'),
            coalesce(nullif(current_setting('mim.audit_user_role', true), ''), 'SYSTEM'),
            act,
            coalesce(nullif(current_setting('mim.audit_module', true), ''), 'system'),
            TG_TABLE_NAME, rid, audit_mask(d_old), audit_mask(d_new),
            nullif(current_setting('mim.audit_ip', true), ''),
            nullif(current_setting('mim.audit_user_agent', true), ''));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- TRUNCATE fires no row triggers, so it gets its own entry.
CREATE FUNCTION audit_truncate() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (user_id, username, user_name, user_role, action, module,
                           table_name, record_id, new_values, ip_address, user_agent)
    VALUES (nullif(current_setting('mim.audit_user_id', true), '')::uuid,
            coalesce(nullif(current_setting('mim.audit_username', true), ''), 'system'),
            coalesce(nullif(current_setting('mim.audit_user_name', true), ''), 'system'),
            coalesce(nullif(current_setting('mim.audit_user_role', true), ''), 'SYSTEM'),
            'delete',
            coalesce(nullif(current_setting('mim.audit_module', true), ''), 'system'),
            TG_TABLE_NAME, '*', '{"truncate": true}'::jsonb,
            nullif(current_setting('mim.audit_ip', true), ''),
            nullif(current_setting('mim.audit_user_agent', true), ''));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Attach the triggers to every table in the schema that lacks them.
-- Not audited: the log itself, Flyway's history, and doc_counter (document
-- number counters — one noise row per document, no business data).
-- Returns the number of tables newly attached.
-- ---------------------------------------------------------------------
CREATE FUNCTION audit_attach_all() RETURNS integer AS $$
DECLARE
    t record;
    added integer := 0;
BEGIN
    FOR t IN
        SELECT c.oid, c.oid::regclass AS rel
          FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = 'public' AND c.relkind = 'r'
           AND c.relname NOT IN ('audit_log', 'flyway_schema_history', 'doc_counter')
           AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = c.oid AND g.tgname = 'zz_audit_row')
    LOOP
        EXECUTE format('CREATE TRIGGER zz_audit_row AFTER INSERT OR UPDATE OR DELETE ON %s '
                    || 'FOR EACH ROW EXECUTE FUNCTION audit_row()', t.rel);
        EXECUTE format('CREATE TRIGGER zz_audit_truncate AFTER TRUNCATE ON %s '
                    || 'FOR EACH STATEMENT EXECUTE FUNCTION audit_truncate()', t.rel);
        added := added + 1;
    END LOOP;
    RETURN added;
END;
$$ LANGUAGE plpgsql;

SELECT audit_attach_all();
