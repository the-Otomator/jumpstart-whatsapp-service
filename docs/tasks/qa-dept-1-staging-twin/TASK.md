# TASK — QA 1 — סביבת בדיקה ל-Hub: ענף staging, תאום פרודקשן, שליחה לניצן בלבד

Run under the "Cowork task packages" protocol in this repo's AGENTS.md. Do not ask questions; hard stops only.

| | |
|---|---|
| Slug | `qa-dept-1-staging-twin` |
| Work task | "מחלקת QA" (`5dd8b229-97be-40d0-8596-8f36f9ba22af`) |
| Dev task | `e304a098-5c40-44af-b74a-b1309262f68b` — "QA 1 — סביבת בדיקה ל-Hub: ענף staging, תאום פרודקשן, שליחה לניצן בלבד" (PR body line: `Task: jumpstart-task e304a098-5c40-44af-b74a-b1309262f68b`) |
| Release level | L3/L4 |
| Branch | `feature/qa-dept-1-staging-twin` from `origin/main` (otomator-admin: `origin/master`) |
| Worktree | `C:\Users\Me\projects\<repo>\.worktrees\qa-dept-1-staging-twin` |
| Package | `C:\Users\Me\projects\jumpstart\_tasks\qa-dept-1-staging-twin\` |
| Test environment | JumpStart Staging (`jumpstart-staging` / `tyiylxtihzvxooecurwe`) — the one test environment |
| Test user | Staging QA identities (DECISIONS D-07); production: read-only as Nizan in org Otomator |
| Approval | Plan `PLAN.html` + screens `DESIGN.html` approved by Nizan 2026-11-10 · **Emergency release approved (merge + deploy off-window)** |
| Sequence | QA 1 → QA 2 → QA 3 → QA 4. Start only when the previous package is merged; one executor at a time. |

Repos (one PR each):
- `the-Otomator/jumpstartapp`
- `the-Otomator/jumpstart-whatsapp-service` (scoped key, D-18/D-19)

Off-window approved by Nizan: 2026-11-10 14:54 — QA department emergency (approved in Cowork chat 2026-11-10)

## Goal — what is true when this is done
1. Branch `staging` in jumpstartapp auto-deploys to `staging.hub.jumpstart.co.il` against JumpStart Staging only, with the non-dismissible banner (DESIGN §1, §8 phone).
2. Staging holds a sanitized twin of every production org, refreshed nightly, with a stored safety report (LOGIC §2).
3. Every outbound channel on Staging really delivers, rewritten to Nizan only, from Otomator's own WhatsApp device, with the volume cap (LOGIC §3); payments only via SUMIT test company.
4. One-time login per role (owner, staff/manager, instructor, end customer) works on Staging and is refused on production (LOGIC §4).

## In scope
LOGIC §1, §2, §3, §4, §7. Banner = staging-only build flag (never in production bundle).

## Out of scope (do not touch)
QA runner/suites (qa-dept-2), release gate and merge retargeting (qa-dept-3), admin screens (qa-dept-4), any production behaviour change.

## Source of truth
- Approved plan: `PLAN.html` · Look: `DESIGN.html` · Behaviour: `LOGIC.md` · Forks: `DECISIONS.md` · Done: `ACCEPTANCE.md` · After merge: `RELEASE.md`

## Authorized now
Worktree, branch, commits, push, PR; create branch `staging`; Cloudflare Pages staging environment + custom domain `staging.hub.jumpstart.co.il`; any schema/data/cron/function/secret change on Staging (`tyiylxtihzvxooecurwe`) only; read-only production reads (BEGIN READ ONLY); turning Staging crons on after AC-05/AC-06/AC-06b pass.
Everything else is forbidden until RELEASE.md runs.

## Limits
- Production DB read-only; no production migration, Edge deploy, merge, send or charge before RELEASE.md.
- No GitHub Actions minutes for QA runs.
- Secrets: `otomator-dev/systems/jumpstart/SECRETS-AND-SETTINGS.md` (100-secret cap); no credential in Git, chat, RESULT or evidence.
- Fail closed everywhere (LOGIC §3, §6). Never loosen RLS/auth/guards to pass a test.
- No WhatsApp session other than Otomator's own (D-14).

## Definition of done
All Codex ACs pass with evidence · PR(s) open with task line · preview/staging shows the result · `RESULT.md` written · `STATE.json` phase `ready_for_cowork`. At the end of RESULT add "Package gaps" — anything this package should have said so Codex wouldn't need to decide.
