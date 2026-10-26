# LOGIC — wa-history-pull

## Verified facts (live, queried 2026-10-26)
| Fact | Source |
|---|---|
| Baby Shiri org = `8e93d62f-e612-4642-9298-da90999689ca`; one device `48b99cee-5892-4c9a-aaca-a0e89ea48301` (baileys, organizational, `listen_only=false`, connected) | `wa_devices` |
| Second org row named בייבי שירי (`7eb19c86-…`) has no device — ignore it | `organizations`, `wa_devices` |
| Audience size: `crm_contacts.status in ('customer','active')` = 136; `status='lead' and created_at >= now()-90d` = 877 (873 with phone) | `crm_contacts` |
| Only 2 of the 136 customers/active have any saved message today → most chats have no anchor yet | `wa_conversations` ⨝ `wa_messages` |
| Messages are saved only when `wa_logging_settings.enabled=true` for the org (`logMessage` gate, `_shared/waLog.ts` `readSettings`, 30s cache). Baby Shiri enabled 2026-10-26 10:24 UTC | deployed `wa-webhook` v260 + table |
| History messages are dropped by the service unless the device is listen-only | `jumpstart-whatsapp-service` `src/providers/baileys/baileysProvider.ts` ~L361-365 (`captureMessages`, `if (history && !listenOnly) return`), event at ~L541 (`messaging-history.set`), main `0e00483` |
| `wa-webhook` ignores `fromMe` unless observed → the business's own side would be lost | deployed `wa-webhook/index.ts` ~L402-404 |
| `wa-webhook` runs `handleInboundJourneyReply` (consent / journey replies) with NO `isBackfill` guard | deployed `wa-webhook/index.ts` ~L597-603 |
| Backfill flags already recognised: `isBackfill`, `is_backfill`, `history`, `skipDownstream`; portal event, transcription, intelligence already skip on backfill | deployed `wa-webhook/index.ts` ~L559-590, L646, L654, L720 |
| Message dedupe key: `wa_messages (organization_id, device_id, wa_message_id)`; columns include `direction, timestamp, is_backfill, source, observed, contact_id, conversation_id` | `information_schema.columns` |
| Baileys `^7.0.0-rc14` — exposes on-demand history (`fetchMessageHistory(count, oldestKey, oldestTimestamp)`), results arrive on `messaging-history.set` as an on-demand sync; max 50 per request | service `package.json` |
| Live phone-typed replies from the business are not stored for any normal device (only Hub/automation sends) | `wa_messages` last 2 days by device/direction/source |

## Entities
- Per-org: switch (default off) + audience rule. Baby Shiri's rule = customers/active + leads created in the last 90 days (evaluated at sweep/auto-pull time). Private chats only.
- Per conversation: pull state — never / in progress / done / nothing-older / no-anchor / failed, oldest timestamp reached, messages added, last attempt, attempts, who/what started it (sweep / auto / button + user id).
- Pulled messages: normal `wa_messages` rows, `is_backfill=true`, a distinct `source` that identifies history pulls, `observed=false`, both directions, `contact_id` + `conversation_id` set.

## Rules
1. **Anchor.** A pull starts from the oldest saved message in that conversation (any direction). No saved message → state `no-anchor`, nothing is requested.
2. **Depth cap.** Stop when the phone returns messages older than 30 days before the pull started; messages older than the cap are not stored. One button press or one sweep item pulls all the way to the cap (or until the phone has nothing older).
3. **Both sides.** `fromMe` → `direction='out'`, otherwise `in`. Group chats are never pulled.
4. **No side effects.** A pulled message never triggers bot, journey/consent replies, triggers/automations, portal events, transcription, intelligence, notifications/toasts, unread count; it never moves `wa_conversations.last_message_at` / preview / direction backwards.
5. **Idempotent.** Re-pulling never duplicates rows (existing dedupe key). A conversation in `in progress` is never started twice.
6. **Pacing.** Per device: one request in flight; at least 5 seconds between requests; sweep pauses while the device is not connected and resumes later. No request ever sends anything to the customer.
7. **Phone offline / no answer.** A request with no answer inside a bounded wait = `failed` for that attempt; sweep/auto retries up to 3 attempts spread over time; the button shows the offline state.
8. **Sweep.** Runs once for the org when started (RELEASE R6) over the audience; skips `done`/`nothing-older`; marks `no-anchor` where needed.
9. **Auto-pull.** While the switch is on, when an audience conversation that was never pulled (or is `no-anchor`) receives its first saved live message, it is queued for one pull.
10. **Switch off** → button hidden, sweep and auto stop, in-flight request may finish, nothing new is requested.

## States (button, top of chat)
| State | When | User sees (DESIGN) |
|---|---|---|
| Hidden | switch off, group chat, or no permission | nothing |
| No anchor | chat has no saved message | muted line N1 |
| Idle | can pull | button B1 |
| Loading | request in progress (incl. started by sweep/auto) | L1 + spinner, button disabled |
| Done | pull finished with N>0 | D1 with N, new messages appear in place |
| Nothing older | phone had nothing within 30 days | E1 |
| Reached cap | already pulled to 30 days | C1 (button gone) |
| Phone offline | device not connected / no answer | O1 + retry button |
| Error | anything else | friendly error F1; automatic system-error ticket per the org's friendly-errors rule |

## Permissions
Whoever can open the conversation in the Hub can press the button for that conversation; everything is scoped to the caller's org; the server entry point re-checks org + switch + device ownership. Sweep/auto run server-side only.

## Edge cases
- Same phone in several conversations / devices → pull only the conversation the anchor belongs to.
- Contact matched by phone but `wa_conversations.contact_id` null → link by `phone_normalized`/`phone_e164`; never create contacts from history.
- Media in history: store metadata as the existing pipeline does; a failed media download never fails the message.
- Very long chats: the 30-day cap bounds work; one conversation never blocks the sweep.
- Device swapped/re-paired mid-sweep → stop for that device; resume only if the same device id is connected.

## Exact copy (Hebrew)
| Key | Text |
|---|---|
| B1 | טען הודעות קודמות |
| L1 | מושכים הודעות מהטלפון… רגע של סבלנות ☕ |
| D1 | נוספו {n} הודעות מהחודש האחרון |
| E1 | אין הודעות קודמות מהחודש האחרון — השיחה כבר מלאה 🙂 |
| C1 | כל ההודעות מהחודש האחרון כבר כאן |
| N1 | עוד אין הודעות בשיחה הזו. אחרי ההודעה הראשונה נוכל למשוך גם את ההיסטוריה |
| O1 | הטלפון של המספר לא זמין כרגע. נסו שוב בעוד כמה דקות |
| O1-btn | לנסות שוב |
| F1 | משהו השתבש במשיכת ההיסטוריה. כבר פתחנו על זה קריאה — אפשר לנסות שוב מאוחר יותר |
