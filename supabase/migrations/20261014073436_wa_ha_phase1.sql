-- Private HA state in otomator-admin (mzalzjtsyrjycaxolldv). APPLY ONLY WITH APPROVAL.
-- No PostgREST exposure, no credentials embedded, no public/registry modifications.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='wa_ha_service') THEN CREATE ROLE wa_ha_service NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='wa_ha_fencer') THEN CREATE ROLE wa_ha_fencer NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='wa_ha_operator') THEN CREATE ROLE wa_ha_operator NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='wa_ha_reader') THEN CREATE ROLE wa_ha_reader NOLOGIN; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('wa_ha_service','wa_ha_fencer','wa_ha_operator','wa_ha_reader') AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'HA_GROUP_ROLE_ATTRIBUTES_UNSAFE'; END IF;
END $$;
CREATE SCHEMA wa_ha;
REVOKE ALL ON SCHEMA wa_ha FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA wa_ha REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE wa_ha.nodes (
 node_id text PRIMARY KEY CHECK(node_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
 db_role name NOT NULL UNIQUE, fencer_role name UNIQUE,
 provider text NOT NULL, resource_id text NOT NULL,
 boot_id uuid, enabled boolean NOT NULL DEFAULT true,
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','fencing','fenced')),
 fencing_enabled boolean NOT NULL DEFAULT false,
 session_capacity integer NOT NULL CHECK(session_capacity>0),
 last_seen timestamptz, UNIQUE(provider,resource_id)
);
CREATE TABLE wa_ha.node_heartbeats(node_id text PRIMARY KEY REFERENCES wa_ha.nodes,boot_id uuid NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE wa_ha.leases (
 session_key text PRIMARY KEY CHECK(length(session_key) BETWEEN 1 AND 256),
 owner_node text REFERENCES wa_ha.nodes, owner_boot uuid,
 epoch bigint NOT NULL DEFAULT 0 CHECK(epoch>=0), expires_at timestamptz NOT NULL DEFAULT '-infinity',
 CHECK((owner_node IS NULL)=(owner_boot IS NULL))
);
CREATE INDEX leases_owner_expiry ON wa_ha.leases(owner_node,expires_at);
CREATE TABLE wa_ha.fences (
 node_id text NOT NULL REFERENCES wa_ha.nodes, boot_id uuid NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(), evidence text NOT NULL,
 PRIMARY KEY(node_id,boot_id)
);
CREATE TABLE wa_ha.auth_state (
 session_key text NOT NULL REFERENCES wa_ha.leases,
 item_key text NOT NULL CHECK(length(item_key) BETWEEN 1 AND 512),
 encrypted jsonb NOT NULL CHECK(jsonb_typeof(encrypted)='object' AND octet_length(encrypted::text)<4194304),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(session_key,item_key)
);
CREATE TABLE wa_ha.catalog (
 session_key text PRIMARY KEY REFERENCES wa_ha.leases,
 encrypted_meta jsonb NOT NULL, auto_restore boolean NOT NULL DEFAULT true
);
CREATE TABLE wa_ha.capacity_samples (
 node_id text NOT NULL REFERENCES wa_ha.nodes, sampled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 boot_id uuid NOT NULL, metrics jsonb NOT NULL,
 PRIMARY KEY(node_id,sampled_at), CHECK(jsonb_typeof(metrics)='object' AND octet_length(metrics::text)<8192)
);
CREATE INDEX capacity_recent ON wa_ha.capacity_samples(sampled_at DESC);
CREATE TABLE wa_ha.alerts (
 node_id text NOT NULL REFERENCES wa_ha.nodes, code text NOT NULL,
 target_node text NOT NULL DEFAULT '', first_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_at timestamptz NOT NULL DEFAULT clock_timestamp(), occurrences integer NOT NULL DEFAULT 1,
 resolved_at timestamptz, PRIMARY KEY(node_id,code,target_node)
);
CREATE TABLE wa_ha.operator_approvals (
 action_id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('provision','manual-fence','rejoin','activate-fencing')),
 target text NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 approved_by text NOT NULL CHECK(length(approved_by)>0), expires_at timestamptz NOT NULL,
 consumed_at timestamptz
);
-- No table privileges for runtime roles. Definer entrypoints are the only mutations.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='wa_ha' LOOP
  EXECUTE format('ALTER TABLE wa_ha.%I ENABLE ROW LEVEL SECURITY',r.tablename);
 END LOOP;
END $$;
CREATE FUNCTION wa_ha.identity(p_boot uuid) RETURNS wa_ha.nodes
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes;
BEGIN
 SELECT * INTO n FROM wa_ha.nodes WHERE db_role=session_user AND enabled AND state='ready' AND boot_id=p_boot FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HA_NODE_DISABLED_OR_BOOT_MISMATCH' USING ERRCODE='P0001'; END IF;
 RETURN n;
END $$;
CREATE FUNCTION wa_ha.register_node(p_boot uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes;
BEGIN
 SELECT * INTO n FROM wa_ha.nodes WHERE db_role=session_user FOR UPDATE;
 IF NOT FOUND OR NOT n.enabled OR n.state<>'ready' OR (n.boot_id IS NOT NULL AND n.boot_id<>p_boot) THEN
  RAISE EXCEPTION 'HA_EXPLICIT_REJOIN_REQUIRED';
 END IF;
 UPDATE wa_ha.nodes SET boot_id=p_boot,last_seen=clock_timestamp() WHERE node_id=n.node_id;
 RETURN jsonb_build_object('nodeId',n.node_id,'fencingEnabled',n.fencing_enabled,'capacity',n.session_capacity);
END $$;
CREATE FUNCTION wa_ha.try_acquire(p_key text,p_boot uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes; l wa_ha.leases; t timestamptz;
BEGIN
 n:=wa_ha.identity(p_boot);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key,74153));
 INSERT INTO wa_ha.leases(session_key) VALUES(p_key) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT l FROM wa_ha.leases WHERE session_key=p_key FOR UPDATE;
 t:=clock_timestamp();
 IF l.owner_node=n.node_id AND l.owner_boot=p_boot AND l.expires_at>t THEN
  RETURN jsonb_build_object('owned',true,'epoch',l.epoch::text,'remainingMs',extract(epoch FROM l.expires_at-t)*1000);
 END IF;
 IF l.expires_at>t THEN RETURN jsonb_build_object('owned',false,'owner',l.owner_node,'boot',l.owner_boot,'expired',false); END IF;
 IF l.owner_node IS NOT NULL AND NOT EXISTS(SELECT FROM wa_ha.fences WHERE node_id=l.owner_node AND boot_id=l.owner_boot) THEN
  RETURN jsonb_build_object('owned',false,'owner',l.owner_node,'boot',l.owner_boot,'expired',true);
 END IF;
 UPDATE wa_ha.leases SET owner_node=n.node_id,owner_boot=p_boot,epoch=l.epoch+1,expires_at=t+interval '60 seconds' WHERE session_key=p_key;
 RETURN jsonb_build_object('owned',true,'epoch',(l.epoch+1)::text,'remainingMs',60000);
END $$;
CREATE FUNCTION wa_ha.check_lease(p_key text,p_boot uuid,p_epoch bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes; l wa_ha.leases;
BEGIN
 n:=wa_ha.identity(p_boot);
 SELECT * INTO l FROM wa_ha.leases WHERE session_key=p_key FOR UPDATE;
 IF NOT FOUND OR l.owner_node IS DISTINCT FROM n.node_id OR l.owner_boot IS DISTINCT FROM p_boot OR l.epoch<>p_epoch OR l.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'HA_STALE_LEASE';
 END IF;
END $$;
CREATE FUNCTION wa_ha.node_alive(p_boot uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes;
BEGIN
 n:=wa_ha.identity(p_boot);
 INSERT INTO wa_ha.node_heartbeats(node_id,boot_id) VALUES(n.node_id,p_boot)
 ON CONFLICT(node_id) DO UPDATE SET boot_id=p_boot,observed_at=clock_timestamp();
END $$;
CREATE FUNCTION wa_ha.check_send(p_key text,p_boot uuid,p_epoch bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes; l wa_ha.leases;
BEGIN
 n:=wa_ha.identity(p_boot);
 -- Claims use the same transaction advisory lock. Auth/ratchet writes and renews
 -- use the lease row instead, so they can COMMIT before Baileys transmits.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key,74153));
 SELECT * INTO l FROM wa_ha.leases WHERE session_key=p_key;
 IF NOT FOUND OR l.owner_node IS DISTINCT FROM n.node_id OR l.owner_boot IS DISTINCT FROM p_boot OR l.epoch<>p_epoch OR l.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'HA_STALE_LEASE'; END IF;
END $$;
CREATE FUNCTION wa_ha.renew(p_key text,p_boot uuid,p_epoch bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM wa_ha.check_lease(p_key,p_boot,p_epoch);
 UPDATE wa_ha.leases SET expires_at=clock_timestamp()+interval '60 seconds' WHERE session_key=p_key;

END $$;
CREATE FUNCTION wa_ha.read_auth(p_key text,p_boot uuid,p_epoch bigint,p_items text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM wa_ha.check_lease(p_key,p_boot,p_epoch);
 SELECT coalesce(jsonb_object_agg(item_key,encrypted),'{}'::jsonb) INTO result FROM wa_ha.auth_state WHERE session_key=p_key AND item_key=ANY(p_items);
 RETURN result;
END $$;
CREATE FUNCTION wa_ha.write_auth(p_key text,p_boot uuid,p_epoch bigint,p_entries jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;
BEGIN
 PERFORM wa_ha.check_lease(p_key,p_boot,p_epoch);
 IF jsonb_typeof(p_entries)<>'object' OR octet_length(p_entries::text)>8388608 THEN RAISE EXCEPTION 'HA_AUTH_BATCH_INVALID'; END IF;
 FOR e IN SELECT * FROM jsonb_each(p_entries) LOOP
  IF e.value='null'::jsonb THEN DELETE FROM wa_ha.auth_state WHERE session_key=p_key AND item_key=e.key;
  ELSE INSERT INTO wa_ha.auth_state(session_key,item_key,encrypted) VALUES(p_key,e.key,e.value)
   ON CONFLICT(session_key,item_key) DO UPDATE SET encrypted=excluded.encrypted,updated_at=clock_timestamp(); END IF;
 END LOOP;
END $$;
CREATE FUNCTION wa_ha.put_catalog(p_key text,p_boot uuid,p_epoch bigint,p_meta jsonb,p_restore boolean,p_purge boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM wa_ha.check_lease(p_key,p_boot,p_epoch);
 IF jsonb_typeof(p_meta)<>'object' OR octet_length(p_meta::text)>65536 THEN RAISE EXCEPTION 'HA_META_INVALID'; END IF;
 INSERT INTO wa_ha.catalog(session_key,encrypted_meta,auto_restore) VALUES(p_key,p_meta,p_restore)
 ON CONFLICT(session_key) DO UPDATE SET encrypted_meta=excluded.encrypted_meta,auto_restore=excluded.auto_restore;
 IF p_purge THEN DELETE FROM wa_ha.auth_state WHERE session_key=p_key; END IF;
END $$;
CREATE FUNCTION wa_ha.list_catalog(p_boot uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM wa_ha.identity(p_boot);
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',session_key,'meta',encrypted_meta,'restore',auto_restore)),'[]'::jsonb) INTO result FROM wa_ha.catalog;
 RETURN result;
END $$;
CREATE FUNCTION wa_ha.fencer_identity(p_boot uuid) RETURNS wa_ha.nodes
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes;
BEGIN
 SELECT * INTO n FROM wa_ha.nodes WHERE fencer_role=session_user AND boot_id=p_boot AND enabled AND state='ready' AND fencing_enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HA_FENCING_NOT_ACTIVATED'; END IF;
 RETURN n;
END $$;
CREATE FUNCTION wa_ha.begin_fence(p_actor_boot uuid,p_target text,p_old_boot uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor wa_ha.nodes; n wa_ha.nodes;
BEGIN
 actor:=wa_ha.fencer_identity(p_actor_boot);
 IF actor.node_id=p_target THEN RAISE EXCEPTION 'HA_CANNOT_FENCE_SELF'; END IF;
 SELECT * INTO n FROM wa_ha.nodes WHERE node_id=p_target FOR UPDATE;
 IF NOT FOUND OR n.boot_id IS DISTINCT FROM p_old_boot THEN RAISE EXCEPTION 'HA_FENCE_TARGET_CHANGED'; END IF;
 IF EXISTS(SELECT FROM wa_ha.leases WHERE owner_node=p_target AND owner_boot=p_old_boot AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'HA_OWNER_LEASE_STILL_LIVE'; END IF;
 UPDATE wa_ha.nodes SET enabled=false,state='fencing' WHERE node_id=p_target;
 RETURN jsonb_build_object('nodeId',n.node_id,'provider',n.provider,'resourceId',n.resource_id,'boot',n.boot_id);
END $$;
CREATE FUNCTION wa_ha.confirm_fence(p_actor_boot uuid,p_target text,p_old_boot uuid,p_resource text,p_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes;
BEGIN
 PERFORM wa_ha.fencer_identity(p_actor_boot);
 SELECT * INTO n FROM wa_ha.nodes WHERE node_id=p_target FOR UPDATE;
 IF NOT FOUND OR n.boot_id IS DISTINCT FROM p_old_boot OR n.resource_id IS DISTINCT FROM p_resource OR n.state<>'fencing' OR length(p_evidence) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'HA_FENCE_CONFIRMATION_INVALID'; END IF;
 INSERT INTO wa_ha.fences(node_id,boot_id,evidence) VALUES(p_target,p_old_boot,p_evidence) ON CONFLICT DO NOTHING;
 UPDATE wa_ha.nodes SET enabled=false,state='fenced' WHERE node_id=p_target;
END $$;
CREATE FUNCTION wa_ha.record_sample(p_boot uuid,p_metrics jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes;
BEGIN
 n:=wa_ha.identity(p_boot);
 IF EXISTS(SELECT FROM jsonb_each(p_metrics) e WHERE e.key=ANY(ARRAY['cpuPercent','ramPercent','diskPercent','owned','connected','messagesPerMinute','renewLatencyMs']) AND jsonb_typeof(e.value)<>'number') THEN RAISE EXCEPTION 'HA_SAMPLE_INVALID'; END IF;
 IF jsonb_typeof(p_metrics)<>'object' OR NOT (p_metrics ?& ARRAY['cpuPercent','ramPercent','diskPercent','owned','connected','messagesPerMinute','renewLatencyMs']) OR (p_metrics->>'owned')::int<0 OR (p_metrics->>'connected')::int NOT BETWEEN 0 AND (p_metrics->>'owned')::int OR (p_metrics->>'messagesPerMinute')::int<0 OR (p_metrics->>'renewLatencyMs')::float<0 OR (p_metrics->>'cpuPercent')::float NOT BETWEEN 0 AND 100 OR (p_metrics->>'ramPercent')::float NOT BETWEEN 0 AND 100 OR (p_metrics->>'diskPercent')::float NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'HA_SAMPLE_INVALID'; END IF;
 INSERT INTO wa_ha.capacity_samples(node_id,boot_id,metrics) VALUES(n.node_id,p_boot,p_metrics);
END $$;
CREATE FUNCTION wa_ha.raise_alert(p_boot uuid,p_code text,p_target text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes;
BEGIN
 -- A node that has been disabled must still be able to report its own fencing failure.
 SELECT * INTO n FROM wa_ha.nodes WHERE db_role=session_user AND boot_id=p_boot;
 IF NOT FOUND OR p_code NOT IN ('FENCE_UNCONFIRMED','SELF_FENCED','RESTORE_FAILED') THEN RAISE EXCEPTION 'HA_ALERT_INVALID'; END IF;
 INSERT INTO wa_ha.alerts(node_id,code,target_node) VALUES(n.node_id,p_code,coalesce(p_target,''))
 ON CONFLICT(node_id,code,target_node) DO UPDATE SET last_at=clock_timestamp(),occurrences=wa_ha.alerts.occurrences+1,resolved_at=NULL;
END $$;
CREATE FUNCTION wa_ha.consume_approval(p_id uuid,p_kind text,p_target text,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE wa_ha.operator_approvals SET consumed_at=clock_timestamp()
 WHERE action_id=p_id AND kind=p_kind AND target=p_target AND request_hash=p_hash AND expires_at>clock_timestamp() AND consumed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'HA_APPROVAL_REQUIRED_OR_USED'; END IF;
END $$;
CREATE FUNCTION wa_ha.operator_node_action(p_id uuid,p_kind text,p_target text,p_hash text,p_boot uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n wa_ha.nodes;
BEGIN
 IF p_hash IS DISTINCT FROM encode(sha256(convert_to(p_kind||E'\n'||p_target||E'\n'||p_boot::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'HA_APPROVAL_PAYLOAD_MISMATCH'; END IF;
 PERFORM wa_ha.consume_approval(p_id,p_kind,p_target,p_hash);
 SELECT * INTO STRICT n FROM wa_ha.nodes WHERE node_id=p_target FOR UPDATE;
 IF n.boot_id IS DISTINCT FROM p_boot THEN RAISE EXCEPTION 'HA_TARGET_BOOT_CHANGED'; END IF;
 IF p_kind='manual-fence' THEN
  UPDATE wa_ha.nodes SET enabled=false,state='fenced' WHERE node_id=p_target;
  INSERT INTO wa_ha.fences(node_id,boot_id,evidence) VALUES(p_target,p_boot,'manual-approved-action:'||p_id::text) ON CONFLICT DO NOTHING;
 ELSIF p_kind='rejoin' THEN
  IF NOT EXISTS(SELECT FROM wa_ha.fences WHERE node_id=p_target AND boot_id=p_boot) THEN RAISE EXCEPTION 'HA_PRIOR_FENCE_REQUIRED'; END IF;
  UPDATE wa_ha.nodes SET enabled=true,state='ready',boot_id=NULL WHERE node_id=p_target;
 ELSIF p_kind='activate-fencing' THEN UPDATE wa_ha.nodes SET fencing_enabled=true WHERE node_id=p_target;
 ELSE RAISE EXCEPTION 'HA_OPERATOR_ACTION_INVALID'; END IF;
END $$;
CREATE FUNCTION wa_ha.fleet_snapshot() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('version',1,'measuredAt',clock_timestamp(),
 'nodes',coalesce((SELECT jsonb_agg((to_jsonb(n)||jsonb_build_object('last_seen',h.observed_at))-'db_role'-'fencer_role') FROM wa_ha.nodes n LEFT JOIN wa_ha.node_heartbeats h USING(node_id)),'[]'::jsonb),
 'samples',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM wa_ha.capacity_samples s WHERE sampled_at>clock_timestamp()-interval '10 minutes'),'[]'::jsonb),
 'alerts',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM wa_ha.alerts a WHERE resolved_at IS NULL),'[]'::jsonb))
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA wa_ha FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wa_ha FROM PUBLIC;
GRANT USAGE ON SCHEMA wa_ha TO wa_ha_service,wa_ha_fencer,wa_ha_operator,wa_ha_reader;
GRANT EXECUTE ON FUNCTION wa_ha.node_alive(uuid),wa_ha.check_send(text,uuid,bigint),wa_ha.register_node(uuid),wa_ha.try_acquire(text,uuid),wa_ha.check_lease(text,uuid,bigint),wa_ha.renew(text,uuid,bigint),wa_ha.read_auth(text,uuid,bigint,text[]),wa_ha.write_auth(text,uuid,bigint,jsonb),wa_ha.put_catalog(text,uuid,bigint,jsonb,boolean,boolean),wa_ha.list_catalog(uuid),wa_ha.record_sample(uuid,jsonb),wa_ha.raise_alert(uuid,text,text) TO wa_ha_service;
GRANT EXECUTE ON FUNCTION wa_ha.begin_fence(uuid,text,uuid),wa_ha.confirm_fence(uuid,text,uuid,text,text) TO wa_ha_fencer;
GRANT EXECUTE ON FUNCTION wa_ha.consume_approval(uuid,text,text,text),wa_ha.operator_node_action(uuid,text,text,text,uuid) TO wa_ha_operator;
GRANT EXECUTE ON FUNCTION wa_ha.fleet_snapshot() TO wa_ha_reader;
COMMIT;
