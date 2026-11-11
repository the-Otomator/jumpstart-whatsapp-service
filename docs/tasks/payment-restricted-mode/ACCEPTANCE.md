# ACCEPTANCE — payment-restricted-mode

| AC | Owner | Env | Steps | Expected | Evidence |
|---|---|---|---|---|---|
| AC-01 | Codex | local | Hub checks, migration safety/version checks, Edge checks, focused tests | green on final SHA (pre-existing base diagnostics listed) | commands + exit codes |
| AC-02 | Codex | Staging DB | State function on fixtures: day 3 grace, day 8 restricted, day 36 restricted, day 38 blocked; full payment at each → ok; partial → unchanged; exempt reasons unchanged; go-live absent → exempt | exact states | SQL + outputs |
| AC-03 | Codex | Staging DB | App-license debt on non-exempt org → org restricted; exempt org with app debt → not | per D3 / fork | SQL |
| AC-04 | Codex | Staging preview | Restricted org as owner and as staff: banner copy, disabled controls on 5 screens (contacts, tasks, automations, broadcasts, clubs/classes) + one app; export works; billing works | DESIGN 1–2 | screenshots desktop + 390px |
| AC-05 | Codex | Staging | Restricted org: try manual WA send, email send, automation run, broadcast, document generation, AI action via API (not only UI) | all refused server-side, nothing sent (provider/outbox shows none) | per-path evidence + guarded path list |
| AC-06 | Codex | Staging | Restricted org: submit public lead form, public registration with test payment page (sandbox), incoming WA message | all stored; nothing outgoing; SUMIT sandbox receipt behaviour recorded | rows + screenshots |
| AC-07 | Codex | Staging | Scheduled message due during restricted → held; pay → resumes if valid / skipped `restricted` if expired | per D6 | outbox rows |
| AC-08 | Codex | Staging | Blocked org: team sees blocked screen; public page/portal shows DESIGN 4; pay → back | DESIGN 3–4 | screenshots |
| AC-09 | Codex | Staging | Owner notifications at restricted start / 3 days / blocked — once each, platform sender only | 3 notifications, correct copy | notification rows |
| AC-10 | Codex | prod read | Production `payment_restricted_mode_go_live_at` absent; `payment_enforcement_go_live_at` unchanged (2026-09-20 16:06:47+00); no prod objects changed | confirmed | SQL |
| AC-20 | Cowork | Staging | End-to-end restricted → pay → restored; API send attempts; read guarded path list | matches LOGIC | VERIFY.md |
| AC-30 | Nizan | Staging | Look at restricted banner + one disabled screen | OK | his OK |
| AC-11 | Codex | Staging DB | New switch `payment_restricted_mode_go_live_at` absent → an unpaid org goes grace (day 3) → blocked (day 8) exactly as today: no restricted phase, public pages unchanged, no new notices. Switch set → grace → restricted (day 8–37) → blocked (day 38) + public pages suspended. Production `payment_enforcement_go_live_at` behaviour identical either way | exact states both ways | SQL + outputs |
