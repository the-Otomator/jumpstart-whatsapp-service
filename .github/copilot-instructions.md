# GitHub Copilot — instructions for this repository

These instructions apply to **GitHub Copilot coding agent** (issues assigned to `@copilot`) and **Copilot code review**.
Also binding: `CLAUDE.md` and `AGENTS.md` in this repo. Where they talk about Cowork task files
(`_task_tmp/<slug>/task.md`, `result.md`, "Authorized now"), this file replaces that mechanic for Copilot:
**your task is the GitHub issue (or the PR comment that mentions you)** and your report is the PR description.
Everything else in those files — release windows, security, data and payment rules — still applies in full.

## Scope and branches
- One issue = one branch = one PR. Work only on your own `copilot/*` branch, based on the latest default branch.
- Do only what the issue asks. No drive-by refactors, renames, dependency bumps or formatting sweeps.
- If the issue is ambiguous or needs a product, schema or architecture decision: do not guess. Comment on the PR with the exact question and stop.
- Never push to `main`/`master`, never merge, never use admin/bypass merge, never close other PRs.
- Never add or remove labels `level:*`, `off-window-approved`, `preview`; never post `release-level` / `release-window` statuses.
- Never edit `.github/workflows/nightly-merge.yml`, `.github/workflows/release-window.yml`, `.github/workflows/release-level.yml`, `.github/release-levels.conf`, `.github/scripts/release-level.sh`, or this file — unless the issue explicitly asks for exactly that.

## Production is off-limits
- You never deploy anything (no `wrangler deploy`, `wrangler pages deploy`, `supabase functions deploy`, `supabase db push`, SSH, D1 `--remote`).
- You never connect to production databases or call production APIs, and you never write data anywhere.
- Database changes = a new migration **file** only. It is applied later through the production migration queue by a human.
- Payments: never call SUMIT (live or sandbox) and never write code that charges, refunds or issues credit notes as a "test".
- No secrets: never print, commit, hardcode or request API keys, service-role keys, tokens or `.env` contents.
- If the PR needs anything after merge (Edge Function deploy, migration, worker deploy, live verification), put the line `Release: manual` in the PR body.

## Validation before you finish
Run the commands listed under "This repo" that apply to the files you touched. All must pass.
Never weaken, skip or delete an existing test or check to make it pass.

## PR description (required)
1. What changed and why (link the issue).
2. Files changed.
3. Validation actually run, with the result of each command.
4. Expected release level: L0 docs · L1 screens only · L2 sensitive/config/deps/workflows · L3 server · L4 database.
5. Anything left undone, risks, and open questions.

## Code review — what to flag first (in this order)
1. Tenant isolation: queries or tables without `organization_id`; RLS missing or permissive (`USING (true)`); new tables/RPCs relying on default grants.
2. `SECURITY DEFINER` functions without `REVOKE EXECUTE ... FROM anon` (unless a deliberate public RPC with a comment).
3. Secrets or `service_role` in frontend code; credentials read from the browser.
4. Money not in integer agorot; floating-point money math.
5. Sends (WhatsApp/email/SMS) that can fire for past events, unknown recipients, or without the org's send settings.
6. Supabase URL hardcoded to `*.supabase.co` in app code instead of `https://api.jumpstart.co.il`.
7. Broken RTL: physical `pl-/pr-/ml-/mr-/left-/right-/text-right` instead of logical `ps-/pe-/ms-/me-/start-/end-/text-start`.
8. Anything that would lower a PR's release level or bypass the night window.
Write review comments in English, short, with the concrete fix.

## This repo — jumpstart-whatsapp-service (Baileys WhatsApp microservice)
- Stack: Node + TypeScript + Express + Baileys, Docker on `wa-prod-1`.
- Validate: `npm run build` (`tsc`) and `npm test`.
- Never connect to the server, never SSH, never touch `sessions/` or session auth state, never send real WhatsApp messages.
- All `/api` routes require the Bearer auth middleware; validate request bodies with Zod.
- Never log message contents, phone numbers in full, or tokens (see logger redaction).
