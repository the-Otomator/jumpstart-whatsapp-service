# DECISIONS — codex-task-package-bootstrap

## Settled by Nizan
| # | Decision | Source |
|---|---|---|
| D1 | Cowork plans, designs, writes logic/conditions/acceptance; Codex executes to the end and returns a branch + preview; Codex checks first, Cowork checks second and defines what is checked | Nizan, 2026-10-17 |
| D2 | Every PR links to its dev task (`Task: jumpstart-task <id>`) | Nizan, 2026-10-08 / 10-15 |
| D3 | Codex never merges in package tasks; Nizan merges | Nizan, 2026-10-16 ("he merges PRs himself") |
| D4 | No model/tier line in Codex tasks | Nizan, 2026-10-14 |

## Pre-answered forks
| If you find… | Do this |
|---|---|
| A repo has no `AGENTS.md` | Create it containing only the section |
| Where to insert | After the first heading block / "Engineering lessons" line, before "Release windows". If neither exists, append at the end. |
| CRLF vs LF | Keep the file's existing line endings; content must be identical after normalising line endings |
| A repo's production branch is `master` | Base on it; PR to it |
| `docs/` does not exist in a repo | Create `docs/tasks/codex-task-package-bootstrap/` |
| Push blocked by a required check that cannot run (billing) | Leave the PR open, note it under Blockers; it is not a hard stop |

## Default rule
Keep the canonical text unchanged → reversible → least outside scope → log in RESULT.
