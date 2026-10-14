-- Explicit approval + night window required. Stop/fence ALL HA nodes first.
-- Export encrypted HA data and verify backup before destructive rollback.
-- Does not restore legacy local credentials or auto-restart any node.
BEGIN;
DROP SCHEMA wa_ha CASCADE;
-- Keep dedicated/group roles: operators must revoke memberships and drop unused
-- login roles after checking pg_shdepend. Avoid deleting unrelated shared roles.
COMMIT;
