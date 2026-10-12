# Periodic WhatsApp recovery

Local execution in isolated worktree `.worktrees/wa-periodic-reconnect`, branch `codex/wa-periodic-reconnect`, base `origin/master` 91e2b84. Dirty root preserved. No production changes or customer messages.

Adds a serial recovery pass every 15 minutes after startup restoration, stopped during shutdown. Only registered Baileys credentials are eligible. Connected/connecting/QR sessions, active sockets, pending reconnect timers, intentional stops, Meta sessions and missing webhook targets are skipped. Manual disconnect and logged-out state persist autoRestore=false; manual start enables it again.

Files: index lifecycle, sessionManager routing, Baileys recovery, sessionStore pairing-flag reader, scheduler and its tests, package test command.

Validation: TypeScript noEmit passed. New recovery regression passed (interval, overlapping passes, error recovery, missing in-memory session, protected states, missing webhook, manual pairing race). Existing restart and socket/keepalive regressions passed. No real network/session operations in tests.

Follow-up audit: registered=false is not evidence of invalid pairing. Four live connected Baileys sessions had registered=false and me.id present. Baileys v7 chooses login versus QR using creds.me. Eligibility now uses stored me.id; a regression covers registered=false with a valid identity and registered=true without one. Credential contents are never logged.

Carina: server logs prove DELETE /api/sessions/<session-key> at 2026-10-12 02:30:08 UTC (05:30 Israel), HTTP 200, followed by metadata removal and intentionally suppressed reconnect. This was an API stop, not an established network outage. Her stored login identity still exists; validity requires a real reconnect attempt. Caller identity is not established from these logs. No reconnect or customer send was performed during this audit.

Limitations: Recovery cannot replace QR authorization when pairing is actually invalid. Normal existing onSessionConnected behavior resumes sender queues; this change introduces no new sending mechanism. Production validation remains pending. Manual stop must not be overridden by the watchdog.

Release: manual
Pending night window: merge and deploy service after Night releases approval; verify scheduler logs and authenticated device status. No release approval or deployment performed.
