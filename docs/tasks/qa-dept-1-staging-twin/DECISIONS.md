# DECISIONS — QA department (shared by qa-dept-1..4)

## Nizan's settled decisions
| # | Decision | Date |
|---|---|---|
| N1 | Test branch per system + QA journey set per Hub app; this task = Hub (Q1+Q2) | 2026-11-10 |
| N2 | Staging data = sanitized twin of ALL production orgs, nightly; sends and charges frozen | 2026-11-10 |
| N3 | Hard QA gate before production; emergency runs a 5–10 min critical suite | 2026-11-10 |
| N4 | Standing "merge what's ready" now targets `staging`; production only after QA green | 2026-11-10 |
| N5 | One Staging project only — no extra Supabase project. Admin/other systems in Q4 reuse `jumpstart-staging` (e.g. separate schema) | 2026-11-10 |
| N6 | WhatsApp test instance (Q4) uses Nizan's own number | 2026-11-10 |
| N7 | Staging is the one test environment; no separate DB test branches | 2026-11-06 |
| N8 | Don't invent extra test orgs for checks / don't touch Nizan's main user | 2026-11-04 |
| N9 | Real sends/charges/SUMIT live actions forbidden; tests in SUMIT test company only | standing |
| N11 | QA tests run against test terminals; all Staging messages are really sent, to a customer whose phone is Nizan's | 2026-11-10 |
| N12 | Approved: WhatsApp sender on Staging = Otomator own device only; background automations delivered only for Otomator/Tnuatef/Baby Shiri twins, cap 100/day/channel; screens 1–7 approved | 2026-11-10 |
| N10 | Execute Q1+Q2 as 4 Codex packages in sequence (1 staging+twin, 2 QA engine, 3 release gate, 4 admin screens), emergency release for all (merge + deploy off-window approved); UI (L1) split from server/DB (L3/L4) per Nizan method | 2026-11-10 |

## Forks pre-answered
| # | If you find… | Do |
|---|---|---|
| D-01 | Existing auto-merge / night release / "למזג עכשיו" merge straight to `main` | Retarget them to `staging`; promotion staging→main goes through the gate. Keep window/limit rules as they are for the promotion step. |
| D-02 | A table/column in production holds personal data not covered by LOGIC §2 | Treat as personal → replace. When unsure, replace. List them in RESULT §4. |
| D-03 | Full twin of all orgs is too big for one night run / Staging compute | Incremental refresh by org or by changed rows is fine; the guarantee is "all orgs, at most 24h old". Staging compute upgrade is NOT authorized — hard stop with cost if truly required. |
| D-04 | A production function/cron body embeds production hosts or credentials | Rewrite to Staging equivalents or disable that one cron with a recorded reason; never copy the credential. |
| D-05 | Delivery destinations | All rewritten to `972528393669` / `nizan+qa-<org>@otomator.co.il` (LOGIC §3). Volume cap as in LOGIC §3. |
| D-14 | Otomator WhatsApp sender for Staging (resolved 2026-11-10 after QA 1 preflight) | Use Otomator's existing own device **"אוטומטור ראשי"** (production `wa_devices` id `0f16963a-94f4-4bdc-905f-b68b5ed365eb`, org Otomator, provider baileys, kind organizational, status connected, number ending 3669 = Nizan's own number, approved N6). Bind the Staging send adapter to that session through the existing WhatsApp service; store the session reference only as a Staging secret/setting (read it with a read-only production query, never print it). Destination is still forced to `972528393669` (self-chat is expected). Never use device `84920ad6…` (personal) or any other org's device. If that device is not connected at run time → that channel stays fail-closed, record it, continue everything else. |
| D-16 | Push subscription for Nizan's test device | Not a blocker. Push stays fail-closed until Nizan subscribes. After the staging address is live, RESULT asks Nizan for one action: open `staging.hub.jumpstart.co.il` on his phone, log in with the one-time owner link, allow notifications. AC-05 push is then verified by Cowork. |
| D-17 | AC-07 duration | Build phase: 2 hours of crons on with zero non-Nizan deliveries is enough for ready_for_cowork. The 24-hour report is a post-release check in RELEASE.md. |
| D-18 | Staging → WhatsApp send path (Nizan 2026-11-10, after FIX-01) | Build a **scoped key** in `jumpstart-whatsapp-service`: a key bound to an allowlist of sessions + an allowlist of recipients (+ optional daily cap), enforced inside the service on every send route, stored hashed, revocable, every use logged; anything outside scope → refused. Issue one key: session of "אוטומטור ראשי" → `972528393669` only, cap per LOGIC §3. Staging holds only this key (Staging secret). The shared bearer is never given to Staging. Generic capability, reused in Q4. |
| D-19 | Deploying the WhatsApp service change to wa-prod-1 | Authorized under the Off-window line, using the service's documented deploy procedure. Must not disconnect any customer session: prefer a reload that keeps sessions; if a restart is unavoidable, only when IDLE-GUARD shows no sends in flight, and verify every device connected before is connected after (count before/after in RESULT). If no deploy access/procedure exists → finish everything else, record `Pending: WA service deploy`, WhatsApp channel stays fail-closed. |
| D-20 | One blocked channel | Never blocks the package: the channel stays fail-closed and is reported; all other goals/ACs continue. |
| D-15 | A bug from the bug library can't be re-introduced cleanly (code moved) | Write an equivalent fault with the same customer-visible symptom; record the mapping. |
| D-06 | Existing Staging orgs (3 synthetic twins, Otomator (Staging), 2 QA WhatsApp orgs) | Synthetic twins are superseded by the full twin — archive them (no hard delete). Keep the others untouched. |
| D-07 | QA identities | Reuse existing synthetic accounts (`rich-*@example.test`, `nizan+user@otomator.co.il` on Staging) attached to the twin of their source org; create only missing roles (end customer, instructor where absent) as `qa-<role>-<org>@example.test`. |
| D-08 | A suite journey fails because of a real existing bug on `main` | Record as baseline (red-test baseline rule, 2026-10-25): gate judges "no new failure vs baseline". List baseline items in RESULT §5 for Cowork to open tickets. Do not fix product bugs in this task. |
| D-09 | Cloudflare custom domain cannot be added (permissions) | Use the stable `staging.jumpstart-hub.pages.dev` alias and report; not a hard stop. |
| D-10 | agents-1 lacks browser deps / capacity | Install under the supported drain/install/resume procedure. If agents-1 can't host it, the home-ai laptop (`systems/local-ai/MAP.md`) is allowed as runner; GitHub Actions is not. |
| D-11 | Existing `verify` job kind could carry QA | Reuse or add a `qa` kind — executor's choice; evidence + gate semantics in LOGIC §5–6 are what matter. |
| D-12 | Gate would block an in-flight emergency already approved before this ships | Gate applies to releases started after RELEASE.md completes. |
| D-13 | Something in SUMIT test company is missing (product/terminal) | Create it in the test company only. |

## Default rule
Choose the option that keeps production untouched, fails closed on Staging, and makes the gate impossible to bypass. Record the choice in RESULT §4.

## Task-specific hard stops
- Any real-person delivery or real charge observed or possible.
- Staging compute/plan upgrade or any new paid service needed.
- A production write needed before RELEASE.md.
