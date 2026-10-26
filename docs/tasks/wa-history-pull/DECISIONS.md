# DECISIONS — wa-history-pull

## Settled by Nizan (do not reopen)
| # | Decision | Date / source |
|---|---|---|
| D1 | Method: on-demand history per chat (Baileys `fetchMessageHistory`), not re-link/QR | 2026-10-26 chat ("תרחיב על 3" → task) |
| D2 | Baby Shiri audience: customers/active + leads created in the last 90 days | 2026-10-26 |
| D3 | Chats with no saved message are not forced (no QR, no listen-only); they get pulled only once they have an anchor | 2026-10-26 |
| D4 | Depth: at most one month back ("גג חודש") — implemented as 30 days before the pull | 2026-10-26 |
| D5 | Include the Hub "load earlier messages" button in this task | 2026-10-26 |
| D6 | Logging enabled for Baby Shiri, Yoni Hillel, Or Glikman; Roni Goberman excluded | 2026-10-26 |
| D7 | System copy positive/light; customer-facing errors friendly + auto ticket | memory rules 2026-10-22 / 2026-10-26 |

## Pre-answered forks
| If you find… | Do this |
|---|---|
| The component already exists elsewhere | Reuse it; do not fork a copy |
| Anchorless request works in Baileys (empty/fake key) | Do NOT use it — D3 stands. Log it in RESULT |
| On-demand results arrive mixed with automatic history on the same event | Distinguish by sync type / request id; only on-demand results are persisted (automatic history keeps today's behaviour) |
| `fetchMessageHistory` missing or broken in rc14 | Upgrade within the Baileys 7 line only if all existing service tests stay green; otherwise hard stop with the evidence |
| Baileys needs `fromMe`/`participant` for the anchor key | Read it from the stored row (`direction='out'` ⇒ fromMe); if a stored row lacks what is needed, use the next-oldest usable row |
| The phone returns fewer than 50 but older ones exist | Keep requesting from the new oldest until cap or empty |
| A needed table/column is missing | Add it by migration in the PR (tenant rules), never applied — RELEASE submits it |
| Hub displays `is_backfill` rows differently or hides them | Pulled rows must show as normal chat messages; adjust display only for this `source` |
| Unread/preview/`last_message_at` would move | Guard it: history never changes them |
| main itself fails a check | Prove it on main, note it, continue |
| Preview build fails for infra reasons | Push a no-op commit once; then report under Blockers and finish the rest |

## Default rule for anything not listed
Keep every behaviour in DESIGN/LOGIC → choose the reversible option → touch the least outside scope → log it in RESULT "Decisions I made". Never stop for it.

## Hard stops (from AGENTS.md) + task-specific
- Anything that would send a WhatsApp message, mark messages read, or change a device's connection.
- Any request against a real device before RELEASE.
- Any change to `wa_logging_settings`, listen-only, or `observed` semantics.
- Deleting or rewriting existing `wa_messages` rows.
