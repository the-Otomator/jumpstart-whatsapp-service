# Deferred manual release — wa_devices hot row

Status: NOT AUTHORIZED before Cowork review and merge. TASK.md's night window (23:00–06:00 IL) applies. No customer sends, owner approvals, auto_reply_from changes, device restarts/disconnects, or message deletion.

1. Review both exact PR heads and green mandatory checks. Preserve the shared observation module byte equality.
2. Inspect current production migration queue, schema, function ACLs and exact SQL hash. Submit the reviewed JumpStart migration through public.migration_queue_submit with repo key jumpstart; wait for the owner's official approval and applied/ledger readback. Never self-approve or apply direct DDL. Existing heartbeat signature remains compatible.
3. Reconcile the deployed wa-webhook source and complete dependency closure with current main before deployment. Preserve newer production changes and JWT settings. Deploy only the reviewed closure after the DB is ready; read back actual deployed bytes/version.
4. Deploy service changes only through a documented route that does not disconnect or restart any customer device. The current service documentation says an SSH process restart disconnects sessions: that route is prohibited by this package. If no non-disruptive route is available, stop the service release and report that hard boundary; do not improvise a restart.
5. After all authorized deployments, observe 30 minutes of production read-only logs and locks: total wa_devices PATCH rate approximately <=50/min, zero heartbeat 400s, zero ungranted device locks. Check messages continue persisting without sending a customer test message. Record actual versions, interval, counts and any incomplete criteria.

No release steps above have been executed by this implementation task.
