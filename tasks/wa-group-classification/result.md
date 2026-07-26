# WA group message classification + participating list

## Part 1 — Classification fix (`baileysProvider`)
**Problem:** `isGroup = remoteJid.endsWith('@g.us')` missed community/LID addressing where `participant` is set but `remoteJid` is `@lid`.

**Fix:** `resolveGroupInbound()` in `src/lib/groupInbound.ts`:
- Group when `remoteJid` or `remoteJidAlt` is `@g.us`, **or** `participant`/`participantAlt` present.
- `groupId` = resolved `@g.us` jid (not sent if unresolvable — debug log only).
- LID→PN via `participantPn` / `senderPn` / lidMapping (existing).
- Verbose key logging removed; ambiguous cases → `log.debug` only.

## Part 2 — `GET /api/groups/:orgId/participating`
Returns all `groupFetchAllParticipating()` groups with `selfIsAdmin`, 6h in-memory cache (same pattern as contact profile).

## Deploy
Rebuild + redeploy VPS Docker container after merge.

```bash
npm run build
# docker compose build && up on wa.otomator.pro
```

## WA-service diff (key)
- `src/lib/groupInbound.ts` (new)
- `src/providers/baileys/baileysProvider.ts` — classification + payload `groupId`/`participantPn`
- `src/routes/groups.ts` — `/participating`
- `src/types.ts` — `ParticipatingGroup`
