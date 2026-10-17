# ACCEPTANCE — codex-task-package-bootstrap

| AC | Owner | Env | Steps | Expected | Evidence |
|---|---|---|---|---|---|
| AC-01 | Codex | local | Extract the block between the markers from each repo's `AGENTS.md` on the PR head, normalise line endings, sha256 | 5 identical hashes = hash of `AGENTS-section.md` block | the 6 hashes |
| AC-02 | Codex | local | `git diff origin/<base>...HEAD --stat` per repo | only `AGENTS.md` + `docs/tasks/codex-task-package-bootstrap/*` | the 5 stat outputs |
| AC-03 | Codex | GitHub | PR body of each PR | contains `Task: jumpstart-task d04323d1-ede3-4ae2-8cf2-0549e3806654` and the package path | 5 PR URLs |
| AC-04 | Codex | local | Lines outside the block in each `AGENTS.md` vs base (ignore EOL) | zero changed lines | diff count per repo |
| AC-10 | Cowork | files | Read each worktree's `AGENTS.md` | section present, release-window text untouched | VERIFY.md |
| AC-11 | Cowork | DB read | `task_pull_requests` where `task_id = d04323d1-…` | 5 rows, one per repo | VERIFY.md |
