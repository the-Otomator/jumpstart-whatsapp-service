# CONTRACT — between the two PRs (service ↔ jumpstartapp)

The package runs as two command-center items, one per repo. Both build against this contract so neither waits for the other.
Names below are the agreed wire contract (constraint, not method). Anything else is the executor's choice.

## 1. Request (jumpstartapp server → WhatsApp service)
Authenticated like every existing `/api/*` call (Bearer service secret, server-side only — never from the browser).
`POST /api/history/fetch`
```json
{ "sessionKey": "<device session key>", "jid": "9725XXXXXXXX@s.whatsapp.net",
  "anchor": { "waMessageId": "<oldest saved wa_message_id>", "fromMe": false, "timestamp": 1792900000 },
  "cutoff": 1790300000, "requestId": "<uuid>" }
```
Responses: `202 {accepted:true}` · `409 {code:"BUSY"}` (a request already in flight for this device) · `409 {code:"NOT_CONNECTED"}` · `400 {code:"BAD_REQUEST"}` (group jid, missing anchor, cutoff > anchor).
Service enforces per device: one in flight, ≥5s between Baileys calls, keeps requesting from the new oldest until `cutoff` or nothing older, max 50 per Baileys call. Never sends, never marks read.

## 2. Results (service → device webhook, same URL/secret as live messages)
Each message: the normal inbound message payload plus
`"history": true, "isBackfill": true, "historyRequestId": "<uuid>", "fromMe": <bool>`.
Messages older than `cutoff` are not forwarded.
At the end, one event: `{"event":"history.done","requestId":"<uuid>","count":<n>,"oldestTimestamp":<unix|null>,"reachedEnd":<bool>,"status":"ok|offline|timeout|error"}`.

## 3. Automatic history (reconnect / listen-only) is unchanged
Only results of a `/api/history/fetch` request carry `historyRequestId`. Everything else keeps today's behaviour.
