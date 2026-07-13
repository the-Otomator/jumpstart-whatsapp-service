# Include group subject + sender name on group inbound

Branch: `feature/wa-group-subject-in-inbound`. Companion app-repo branch: `feature/wa-group-order` (jumpstartapp).

## What changed

- New `src/lib/groupSubjectCache.ts`: in-memory `Map<groupJid, {subject, fetchedAt}>`, 6h TTL, same shape as the existing profile cache.
- `src/providers/baileys/baileysProvider.ts` — `messages.upsert`, group branch: adds `payload.senderName = msg.pushName ?? null`. Looks up group subject from cache; on a miss, calls `sock.groupMetadata(remoteJid).subject` and caches the result; sets `payload.groupSubject` on the webhook payload when resolved. Existing `groupId`/`isGroup`/`from` (participant)/LID handling is unchanged.

## Verify

- `npx tsc --noEmit` — clean.

## Deploy

Prod branch is `master` (NOT `main`) — deploy target is `origin/master`, rebuild + redeploy on the VPS. `wa-webhook` stays public. Deploy this **before or alongside** merging the app-repo PR so the new `groupSubject`/`senderName` fields are actually present on inbound payloads when the app starts reading them.
