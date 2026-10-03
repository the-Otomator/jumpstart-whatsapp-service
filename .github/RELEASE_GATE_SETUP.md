# Release gate — jumpstart-whatsapp-service

Production branch: **master**. The trusted base-branch job posts `release-window` with its own `GITHUB_TOKEN`. `statuses: write` is scoped to that job, guarded by `github.ref == refs/heads/master`. No GitHub App, release-gate environment, APP_ID or APP_PRIVATE_KEY is needed in this repository. JumpStart retains its existing App independently.

`pull_request_target` reads PR metadata/files through the API only; it never checks out or executes PR code. The hourly minute-05 sweep uses production YAML. Nightly merge checks remain SHA-bound, with base classifier, draft/manual restrictions and Nizan's existing admin approvals.

Windows: nightly 23:00–06:00 and Thu 23:00–Sun 08:00 Asia/Jerusalem. Existing docs and approved-label exceptions remain. Day L0/L1 requires the existing admin approval/day-enabled policy and current base classifier.

## Existing configuration and verification

Retain `RELEASE_OPS_URL` (admin release-ops endpoint) and `RELEASE_OPS_SECRET`, the existing shared sync credential. No new App or monitor GitHub token is required. Do not add required checks or change branch protection.

After merge, observe the next normal minute-05 sweep on an open PR: context `release-window`, creator `github-actions[bot]`, target URL to this repository's trusted run. Verify a real successful sync advances `last_sync_at` within 30 minutes; null means never synced. Do not post statuses or fake timestamps for proof.

Portal retains its Pages dispatch. Gesher dispatches its dashboard workflow after approved merges; Worker deployment remains manual. WhatsApp adds no SSH/service deploy. Finance/admin keep their existing Pages deployment. Follow-up function/database operations use `Release: manual`.

## Rollback

Use a reviewed revert PR and normal release controls. Preserve unrelated protection/configuration and incident history. No bypass, direct production push or automatic notification retry.
