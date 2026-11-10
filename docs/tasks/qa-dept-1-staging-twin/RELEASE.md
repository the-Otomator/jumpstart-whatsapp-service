# RELEASE — qa-dept-1-staging-twin

**Emergency approved by Nizan 2026-11-10 — merge + deploy off-window, no window wait.** Runs on Nizan's "Release" line after Cowork PASS.

1. Nothing to release to production except the merge of the PR into `main` (code paths are Staging-gated; production behaviour unchanged). Emergency approved: merge off-window.
2. Live check: production bundle contains no banner and no rewrite path active; production smoke (Hub /, /login, portal login, public signup) 200 with no page errors; logs 10 min.
3. Staging: twin refresh scheduled nightly 02:00 IL; crons on; first 24h delivery report = 0 non-Nizan.

After: write the Release section in RESULT.md; update `otomator-dev/work/qa-department/STATE.md` and `otomator-dev/releases/2026-11.md`.
