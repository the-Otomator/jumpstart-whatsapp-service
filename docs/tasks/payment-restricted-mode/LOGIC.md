# LOGIC — payment-restricted-mode

## Verified facts (live, 2026-11-11, Cowork)
| Fact | Source |
|---|---|
| Enforcement exists: `public.compute_payment_enforcement_state(p_org_id, p_now)` → statuses `ok` / `exempt` / `grace` / `blocked`; grace = `payment_enforcement_grace_days()` = 7 from the failed run (`customer_billing_runs` status `failed`/`awaiting_card`/outcome `failed`/skipped no_payment_method); `block_at = failure_at + 7 days` | `pg_get_functiondef`, 2026-11-11 |
| App-scoped overload `compute_payment_enforcement_state(uuid, timestamptz, text p_app_id)` handles `org_app_licenses` trials (grace → blocked) and delegates `hub`/null to the org function | same |
| **Correction (2026-11-11):** existing enforcement is **live** in production: `system_config.payment_enforcement_go_live_at = 2026-09-20 16:06:47+00`. Today an unpaid failed charge → 7 days grace → `blocked`. (The original line here was wrong — a multi-statement query returned only its last result.) | `system_config`, re-queried 2026-11-11 |
| Production today: 0 orgs in grace/blocked; statuses exempt (trial 20, internal 14, not_paying 13, demo 4, handled_manually 3, no_recurring 3, free 1), ok/paid 5 | all orgs through the function, 2026-11-11 |
| Exemptions exist in `payment_enforcement_org_exemptions` (active) | function body |
| `org_system_subscriptions.status` CHECK: active, trial, trialing, expired, suspended, cancelled; `grace_reason` CHECK only `no_card`; `suspend_expired_no_card_grace()` sets `suspended` | `pg_constraint`, 2026-11-11 |
| Hub: `SubscriptionGate.tsx:37` full-blocks on `payment.status==='blocked'` except billing path for billing managers; `TrialBlockedScreen.tsx` / `TrialExpiryBanner.tsx` render `paymentEnforcement.*` copy; trial lifecycle has its own client-side read-only phase (`compute_org_trial_access`) | files, 2026-11-11 |
| Notifications: `produce_payment_enforcement_notifications`, `produce_payment_enforcement_grace_notifications`, `notify_payment_enforcement_grace_owner` exist | `pg_proc`, 2026-11-11 |

## Timeline (per org)
| Day from first unpaid failed charge | State | |
|---|---|---|
| 0–7 | `grace` (existing) | everything works; existing banner |
| 7–37 | **`restricted`** (new) | LOGIC 4–6 |
| ≥37 | `blocked` (suspension) | team: billing only (existing); public pages: unavailable (DESIGN 4) |
Paying the full debt at any stage → `ok` immediately (next read), settings untouched. Partial payment changes nothing. The grace counter resets only after full payment (terms 4.7.2).

## Rules
1. **Trigger scope = the whole org.** Any unpaid failed paid charge of the org — the JumpStart subscription **or** a paid app license — puts the **org** into grace → restricted → blocked, and the state applies on every team surface (Hub and all apps). App-trial expiry without payment keeps its existing per-app behaviour (it is not debt).
2. **Exempt orgs** (all current exemption reasons) never enter the new states.
3. **Go-live (D7)**: the restricted phase has its own switch, a new setting `payment_restricted_mode_go_live_at`. Absent → today's live behaviour exactly (grace 7 days → blocked; public pages unchanged). Set → grace → restricted → blocked (+ public pages at blocked). Orgs already in `blocked` when it's set stay blocked (no step back to restricted). The existing `payment_enforcement_go_live_at` is untouched.
4. **Restricted — allowed**: view everything; search/filter; export; open billing and pay/update card (owner or billing manager); sign in/out; super-admin support/impersonation as today.
5. **Restricted — stopped (server-side, not only UI)** for that org: outgoing WhatsApp and email (manual, automations, broadcasts, reminders to end customers, scheduled/queued items), automation runs, broadcast sends, document/agreement generation and sending, AI features. Queued/scheduled items due during restricted are **held, not sent and not dropped**; after full payment they resume only if still in their validity window per their existing rules; otherwise they are marked skipped with reason `restricted` (visible in the existing outbox/history).
6. **Restricted — still works (incoming)**: lead forms/webhooks/Meta leads, public registration and payment pages (end customers can pay), incoming WhatsApp/email logging, SUMIT receipts for end-customer payments (legal documents issued by SUMIT). Platform → org messages (billing notices from JumpStart) continue.
7. **Restricted — team writes in the UI**: every create/edit/delete/send/run control is disabled with the restricted tooltip; forms open read-only. Exceptions: billing screens, profile/password, export.
8. **Blocked**: existing behaviour for team (billing only) **plus** the org's public pages and client portal show DESIGN 4 instead of content; incoming webhooks still store data (so nothing is lost if they pay); no outgoing.
9. **Notifications to the owner** (platform sender, email + in-app; WhatsApp via Otomator's own device only per `no-cross-customer-sending`): at restricted start, 3 days before blocked, at blocked. Once each per failure.
10. **Audit**: each state change is recorded with time and reason (reuse existing enforcement event alerting `alert_payment_enforcement_event` if it fits).

## States (team surfaces)
| State | Who | What they see |
|---|---|---|
| grace | all | existing banner (unchanged) |
| restricted | owner / billing manager | `restricted.banner.owner` + pay CTA; disabled controls with `restricted.tooltip` |
| restricted | other staff | `restricted.banner.staff`; disabled controls |
| blocked | owner / billing manager | existing blocked screen, subtitle `blocked.subtitle.v2`, pay CTA |
| blocked | other staff | existing blocked screen, contact owner |
| public page / portal, blocked | anyone | `public.unavailable` |
| paid again | all | normal, no banner |

## Edge cases
- Org with multiple failed runs: earliest unpaid failure drives the clock.
- Payment while blocked → public pages back on next load.
- Restricted org's end customer pays a registration → payment + registration saved; confirmation message held per rule 5 (receipt from SUMIT still issued).
- Super admin impersonating a restricted org sees the restricted UI but can use support actions as today.
- Mobile app / PWA shows the same banner and disabled controls.
- Clock in Asia/Jerusalem for day boundaries (existing grace uses timestamps; keep consistent).

## Exact copy (Hebrew)
| Key | Text |
|---|---|
| restricted.banner.owner | החשבון במצב מוגבל בגלל תשלום שלא הוסדר. אפשר לצפות ולייצא, אבל לא לבצע פעולות או לשלוח הודעות. ב־{date} החשבון יושעה. |
| restricted.banner.staff | החשבון במצב מוגבל. אפשר לצפות בנתונים, אבל לא לבצע פעולות. לפרטים פנו לבעל החשבון. |
| restricted.cta | להסדרת התשלום |
| restricted.tooltip | לא זמין במצב מוגבל |
| restricted.held | {count} הודעות ממתינות ויישלחו אחרי הסדרת התשלום |
| blocked.subtitle.v2 | החשבון הושעה בגלל תשלום שלא הוסדר. הדפים הציבוריים אינם זמינים. הסדרת התשלום תחזיר הכל מיד, כולל ההגדרות. |
| public.unavailable | העמוד אינו זמין כרגע. |
| notify.restricted.start | החשבון שלך ב־JumpStart עבר למצב מוגבל: הנתונים נקלטים ואפשר לצפות בהם, אבל לא ניתן לבצע פעולות ולשלוח הודעות. להסדרת התשלום: {link} |
| notify.restricted.3days | בעוד 3 ימים החשבון שלך ב־JumpStart יושעה, כולל הדפים הציבוריים. להסדרת התשלום: {link} |
| notify.blocked | החשבון שלך ב־JumpStart הושעה. הנתונים נשמרים 60 יום. הסדרת התשלום תחזיר הכל מיד: {link} |
