<!-- COWORK-TASK-PACKAGE v1 (canonical text, identical in every repo) -->
## Cowork task packages — run to the end, no back-and-forth

When the prompt is **"Run the task package `<path>\TASK.md`"** (or "Continue … FIX-NN"), the package folder is the complete spec. Planning, design, logic and decisions are already done and approved by Nizan. Your job: build it, prove it, hand back a PR with a working preview. Do not ask questions; the only reasons to stop early are the **hard stops** below.

### Package files
| File | Owner | Meaning |
|---|---|---|
| `TASK.md` | Cowork | Entry point: goal, scope, out-of-scope, repo/branch, test environment, authorized/limits, definition of done |
| `DESIGN.html` | Cowork | Approved mockup — the visual source of truth (layout, copy, states). Match it. |
| `LOGIC.md` | Cowork | Rules, states, data facts (verified live), permissions, edge cases, exact copy strings |
| `DECISIONS.md` | Cowork | Settled decisions + pre-answered forks ("if X → do Y") + the default rule |
| `ACCEPTANCE.md` | Cowork | Numbered acceptance checks (AC-xx), each with owner (Codex / Cowork / Nizan), env, steps, expected, evidence |
| `RELEASE.md` | Cowork | Post-merge steps (migration queue, Edge deploy, live checks). Optional. |
| `FIX-NN.md` | Cowork | A fix round after verification. Same branch, same PR. |
| `STATE.json` | both | Phase, branch, PR, preview URL, round. Resume from it; never redo finished phases. |
| `RESULT.md` | **you** | Evidence per AC, decisions you made, checks, preview URL |
| `VERIFY.md` | Cowork | Cowork's verdict on your result |

Precedence when files disagree: `DECISIONS` > `LOGIC` > `DESIGN` > `TASK` prose > your judgment. Engineering rules: `docs/LESSONS.md` and the rest of this file still apply.

### Run
1. Read every package file completely. Read `STATE.json` and resume from its `phase`.
2. Worktree: reuse `.worktrees/<slug>` if it exists, else `git worktree add .worktrees/<slug> -b <branch> origin/main`. Never wait on the main clone's `.git/index.lock`.
3. Copy the package into the branch at `docs/tasks/<slug>/` and commit it first, so the PR carries its spec. Keep that copy updated as you write `RESULT.md`/`STATE.json`.
4. Build exactly what `DESIGN` + `LOGIC` describe — complete, no TODOs, no placeholder copy, Hebrew RTL as designed.
5. A fork not covered by `DECISIONS`: apply the **default rule** — pick the option that (a) keeps every behaviour in `DESIGN`/`LOGIC`, (b) is reversible, (c) touches the least outside scope. Log it under "Decisions I made" in `RESULT.md`. Do not stop for it.
6. Self-check: run every AC whose owner is **Codex**, plus this repo's standard checks (typecheck with enough heap, build, focused tests, i18n parity, Hebrew guard, URL/token guards). A failing AC means fix and re-run — not "report and stop". An identical failure on `main` must be proven on `main`.
7. Push; open the PR (or update it). PR body must contain: `Task: jumpstart-task <task-id from TASK.md>`, the package path, and `Release: manual` if `RELEASE.md` exists.
8. Wait for the branch preview to build. Run the UI ACs on the preview URL (not localhost). Record URL + what you saw.
9. Write `RESULT.md` (template in the package), set `STATE.json` → `"phase": "ready_for_cowork"`, commit, push.
10. Chat: max 7 lines — PR number, preview URL, ACs passed/total, blockers or "none".

### Hard stops (the only reasons to stop before step 10)
- Needs a production write, prod migration or Edge deploy that `TASK.md` does not authorize.
- Needs loosening RLS / permissions / auth beyond what `LOGIC.md` states.
- Missing secret, credential or external access you cannot obtain through the repo's normal routes.
- Real money, real customer sends, or deleting data.
- A contradiction the default rule cannot resolve without changing behaviour Nizan will see.

On a hard stop: finish everything else, write `RESULT.md` with `Status: BLOCKED`, the exact question, two options and your recommendation; `STATE.json` → `"phase": "blocked"`; push.

### Never (in package tasks)
Merge, deploy production, apply migrations to production, run `RELEASE.md`, send to real customers, edit files outside scope, change the dev-task status (Cowork owns it).

### Fix rounds and release
- "Continue … FIX-NN": read `VERIFY.md` + `FIX-NN.md`, fix on the same branch/PR, re-run **all** Codex ACs (not only the failed ones), append "Round NN" to `RESULT.md`, phase → `ready_for_cowork`.
- "Release the task package …": only after Nizan merged. Run `RELEASE.md` exactly as written, report in `RESULT.md` → "Release", phase → `released`.
<!-- /COWORK-TASK-PACKAGE v1 -->
