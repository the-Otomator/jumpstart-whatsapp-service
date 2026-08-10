# Connect session recovery fix

## Scope

Fix `/connect/:sessionKey` remaining on `Not found` after webhook hardening made
`startSession` reject calls without a valid inbound webhook target.

## Root cause

`src/routes/connect.ts` still called `startSession(orgId)` with no `webhookUrl`.
Since commit `35dd899`, `startSession` intentionally fails closed with
`WEBHOOK_URL_REQUIRED`, so the page's polling eventually displayed `Not found`.

## Changes

- `src/lib/jumpstartSupabase.ts`
  - Added `resolveJumpstartWebhookUrl(sessionKey)`.
  - It returns Jumpstart's canonical `wa-webhook` URL only when the exact
    `session_key` already exists in Jumpstart `wa_devices`.
  - Missing configuration, missing rows, and query failures return `null`.
- `src/routes/connect.ts`
  - Reuses a valid webhook from an existing disconnected session.
  - Otherwise resolves the server-owned Jumpstart webhook for the registered
    device before starting.
  - Does not accept a webhook URL from the public request.
  - Does not purge a disconnected session unless a trusted target was found.
- `src/lib/jumpstartSupabase.test.ts` and `package.json`
  - Added coverage for configured/unconfigured, found/missing, and query-error
    resolver outcomes.

## Routing

Local isolated worktree from `origin/master`:
`.worktrees/connect-session-start`, branch `codex/fix-connect-session-start`.

## Validation

- `..\..\node_modules\.bin\tsc.cmd --noEmit` — exit 0.
- `npm test` — exit 0, including the new resolver test and the existing suite.
- `git diff --check` — exit 0 (line-ending warnings only).

## Known limitations

- The fix is local only. The live URL will remain unchanged until deployment.
- Recovery is intentionally limited to registered Jumpstart `wa_devices` rows.
  Other partner flows must start sessions through their authenticated API flow
  with their own trusted webhook target.
- Browser automation could not attach in this Windows session (`process`
  bootstrap conflict), so live reproduction used the supplied screenshot plus
  source/contract inspection. No production write was performed.

## Approval-blocked operations

No commit, push, pull request, deployment, production restart, credential use,
or production session start was performed. Each requires explicit authorization.
