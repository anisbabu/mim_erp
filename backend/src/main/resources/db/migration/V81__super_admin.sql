-- Super admin: an ADMIN who may also read the activity log (audit_log).
-- Kept as a flag, not a role, so every other ADMIN permission is unchanged.
-- No API sets it: it is granted here (or by SQL), so no admin can grant it to himself.
ALTER TABLE app_user ADD COLUMN super_admin boolean NOT NULL DEFAULT false;
UPDATE app_user SET super_admin = true WHERE username = 'anis';
