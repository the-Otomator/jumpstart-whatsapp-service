# ACCEPTANCE — wa-history-pull

Owner: **Codex** = runs it before handing back · **Cowork** = verifies on preview / DB / after release · **Nizan** = final look.
Evidence goes into RESULT.md (command output, counts, screenshot path, URL). "Should pass" is not evidence.

| AC | Owner | Env | Steps | Expected | Evidence |
|---|---|---|---|---|---|
| AC-01 | Codex | local | Both repos: typecheck · build · full existing test suites · Hub i18n parity + Hebrew guard | all green on final SHAs | commands + exit codes + SHAs |
| AC-02 | Codex | local | Service test: on-demand result (in + fromMe) is forwarded as history with direction info; automatic history on a non-listen-only device is still dropped | both assertions pass | test name + output |
| AC-03 | Codex | local | Service test: no anchor / device not connected / switch off → no call to Baileys | zero calls | test output |
| AC-04 | Codex | local | Service test: pacing — 3 requests for one device → never 2 in flight, ≥5s apart | pass | test output |
| AC-05 | Codex | local | Pipeline test: pulled `fromMe` message stored `direction='out'`, `is_backfill=true`, history `source`, `observed=false`, `contact_id` + `conversation_id` set | pass | test output |
| AC-06 | Codex | local | Pipeline test: pulled message with body "הסר" / journey reply text → no consent/journey call, no bot, trigger, portal event, transcription, intelligence, unread change | all zero | test output with spies |
| AC-07 | Codex | local | Pipeline test: message older than 30 days in a pull → not stored; `last_message_at`/preview unchanged after a pull | pass | test output |
| AC-08 | Codex | local | Pipeline test: same pull twice → no duplicate rows; second start while in progress → rejected | pass | test output |
| AC-09 | Codex | local | Migration review: new objects have `organization_id`, RLS, explicit grants, definer revokes; switch defaults off for every org | checklist + `has_table_privilege`/`has_function_privilege` expectations written as SQL in RESULT | SQL text |
| AC-10 | Codex | preview | Open a contact card chat and the WhatsApp inbox thread as Nizan (switch off) | no button, chat unchanged | screenshots + URL |
| AC-11 | Codex | preview / story | Render every button state in DESIGN (Idle, Loading, Done, Nothing older, Reached cap, No anchor, Offline, Error) via component test or story | matches DESIGN, RTL, mobile width | screenshot paths |
| AC-20 | Cowork | DB read | Review migration + server code in worktrees; confirm the gates in LOGIC rules 4–6, 10 | as LOGIC | VERIFY |
| AC-21 | Cowork | after release (R4) | One pull on one of Nizan's own chats on device "ניצן - פרטי" | rows added both directions, ≤30 days, no side effects (no new tasks/notifications/journey logs for that contact) | SQL counts in VERIFY |
| AC-22 | Cowork | after release (R6) | Baby Shiri sweep summary | per-state counts (done / nothing-older / no-anchor / failed) add up to the audience's private chats; zero outbound messages from device `48b99cee-…` during the sweep | SQL |
| AC-23 | Nizan | prod | Open Yam Tmima's card in Baby Shiri after she has a message; press the button | earlier messages from the last month appear | his OK |

Regression guard (Codex): live inbound saving, Hub send, broadcasts, bot replies, listen-only observation, reconnect backfill guard — existing tests stay green.
