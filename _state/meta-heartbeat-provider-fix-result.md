# Official Meta false-disconnect diagnosis — 2026-10-11

Route: local isolated worktree, codex/meta-heartbeat-provider-fix from origin/master 3425b3b. Dirty primary checkout preserved.

Root cause in source: listActiveSessions aggregates all providers; buildHeartbeatUpdates previously required isSocketOpen(getBaileysSocket(key)) for every provider. Meta sessions have no Baileys socket and were written disconnected every heartbeat. Production row meta-1f63d665b06549c7ad0492427cfb7265 reverted from a conditional connected reconciliation to disconnected, with updated_at advancing at minute cadence. Linked Meta account DB state was connected, token_health healthy, sending_paused_at null. This is source diagnosis plus matching DB observations, not live process/log attribution or a new Graph token check.

Changes: src/lib/waDeviceReconcile.ts excludes non-Baileys providers from Web heartbeat writes; src/lib/waDeviceMonitor.ts excludes them from heartbeat/outage tracking inputs; regression covers connected/disconnected/connecting Meta sessions, no socket callback for Meta, and closed Baileys sockets still disconnect.

Validation: waDeviceMonitor.test.ts passed including Meta regression; TypeScript --noEmit passed.

Release: manual. Pending night window: merge and deploy service; reconcile official device status from authoritative Meta account health; observe at least two heartbeat cycles; send approved test only to 972528393669 and verify provider delivery receipt. No production deployment performed. No successful test send yet. Do not send customer login tokens to the test recipient.
