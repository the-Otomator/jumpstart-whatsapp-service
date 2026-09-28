PARTIAL — Pending night window: Phase B

# Release-window rule — jumpstart-whatsapp-service

- Routing: local isolated worktree, branch `chore/release-window-gate` from `origin/master`.
- PR: pending.
- Files: `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/cowork-exec-contract.mdc`, `.github/workflows/nightly-merge.yml`.
- Nightly workflow: `PROD_BRANCH=master`, `DEPLOY_WORKFLOW=''`, `GATE_WORKFLOW=''`.
- Preflight: authenticated GitHub admin; repository public; default branch `master`. This manual-deploy repository intentionally gets no `release-window` workflow or branch-protection change.
- Contradictions found: none.
- Validation: `nightly-merge.yml` parsed successfully with the repository's installed `yaml` parser.
- Phase B not run because Israel time was outside 23:00–06:00. Pending: normal merge of the Phase A PR only; no production SSH deploy is authorized by this task.
