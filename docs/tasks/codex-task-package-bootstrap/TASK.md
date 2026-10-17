# TASK — Install the Cowork task-package protocol in all 5 repos

This is the first package under the new protocol. The protocol text it installs is in
`C:\Users\Me\projects\jumpstart\_project-guides\codex-task-package\AGENTS-section.md` — follow it for this run too.
Do not ask questions; hard stops only.

| | |
|---|---|
| Slug | `codex-task-package-bootstrap` |
| Dev task | `d04323d1-ede3-4ae2-8cf2-0549e3806654` — "Codex task packages — one-shot pipeline (AGENTS.md protocol in 5 repos)" (PR body line: `Task: jumpstart-task d04323d1-ede3-4ae2-8cf2-0549e3806654`) |
| Repos | `C:\Users\Me\projects\jumpstart`, `…\jumpstart-clientportal`, `…\jumpstart-whatsapp-service`, `…\jumpstart-finance`, `…\otomator-admin` — one PR per repo |
| Branch | `docs/codex-task-package` from each repo's `origin/main` (or its production branch) |
| Worktree | `<repo>\.worktrees\codex-task-package` |
| Package | `C:\Users\Me\projects\jumpstart\_tasks\codex-task-package-bootstrap\` |
| Test environment | docs only — no preview needed |

## Goal
Every repo's `AGENTS.md` contains the canonical "Cowork task packages" section, byte-identical across the 5 repos, so a single line — "Run the task package `<path>\TASK.md`" — is enough for Codex in any of them. Each repo's PR carries this package under `docs/tasks/codex-task-package-bootstrap/`.

## In scope
- `AGENTS.md` in the 5 repos (insert the section; nothing else in the file changes).
- `docs/tasks/codex-task-package-bootstrap/` copy of this package in each PR.

## Out of scope
- The existing "Release windows" section and every other line of `AGENTS.md`/`CLAUDE.md`.
- Workflows, release-level config, code.

## Authorized now
Worktrees, branches, commits, push, open PRs. Nothing else (no merge, no labels, no workflow runs).

## Limits
- Insert the section text exactly as in `AGENTS-section.md` (between its `COWORK-TASK-PACKAGE v1` markers, inclusive). No rewording per repo.
- If a repo already has a `COWORK-TASK-PACKAGE` block, replace that block only.

## Definition of done
5 PRs open, each with the task line, ACs in `ACCEPTANCE.md` pass, `RESULT.md` written in this package folder (main clone path above) and `STATE.json` phase `ready_for_cowork`.
