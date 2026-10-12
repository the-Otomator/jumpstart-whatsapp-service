# Periodic WhatsApp recovery

Local execution in isolated worktree `.worktrees/wa-periodic-reconnect`, branch `codex/wa-periodic-reconnect`, base `origin/master` 91e2b84. Dirty root preserved. No production changes or customer messages.

Adds a serial recovery pass every 15 minutes after startup restoration, stopped during shutdown. Only registered Baileys credentials are eligible. Connected/connecting/QR sessions, active sockets, pending reconnect timers, intentional stops, Meta sessions and missing webhook targets are skipped. Manual disconnect and logged-out state persist autoRestore=false; manual start enables it again.

Files: index lifecycle, sessionManager routing, Baileys recovery, sessionStore pairing-flag reader, scheduler and its tests, package test command.

Validation: TypeScript noEmit passed. New recovery regression passed (interval, overlapping passes, error recovery, missing in-memory session, protected states, missing webhook, manual pairing race). Existing restart and socket/keepalive regressions passed. No real network/session operations in tests.

Limitations: Recovery cannot replace QR authorization when pairing is invalid. Carina's previously inspected credentials were unregistered. Normal existing onSessionConnected behavior resumes sender queues; this change introduces no new sending mechanism. Production validation remains pending.

Release: manual
Pending night window: merge and deploy service after Night releases approval; verify scheduler logs and authenticated device status. No release approval or deployment performed.
