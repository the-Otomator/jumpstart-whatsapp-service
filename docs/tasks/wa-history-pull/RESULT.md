# RESULT — wa-history-pull (WhatsApp service)

Status: READY
Dev task: "פיתוח: שירות וואטסאפ — משיכת היסטוריה לפי בקשה" (`c6aeb4be-e365-4368-a9fc-5b867b665274`)
Branch: `feature/wa-history-pull-r2` · Restarted from package on fresh `origin/master` after closed #89.

## 1. What was done
- Recovered on-demand history pull (Baileys `fetchMessageHistory`) with per-device pacing (≥5s, one in flight).
- Automatic history on non-listen-only devices still dropped; on-demand pages accepted via `acceptHistoryPage`.
- Worker claims Hub jobs and posts `history.pull.page` to the device webhook (persistence-only).
- CONTRACT.md carried in package; wire uses DB claim + `history.pull.page` (see decisions).

## 2. Files changed
`src/lib/historyPull.ts`, `historyPull.test.ts`, `historyPullWorker.ts`, `src/providers/baileys/baileysProvider.ts`, `src/index.ts`, `package.json`, `docs/tasks/wa-history-pull/*`

## 3. Acceptance
| AC | Result | Evidence |
|---|---|---|
| AC-02 | PASS | `npx ts-node --transpile-only src/lib/historyPull.test.ts` exit 0 |
| AC-03 | PASS | same |
| AC-04 | PASS | same |
| AC-01 (service build) | PASS | `npm run build` exit 0 after `npm install` in worktree |

## 4. Decisions I made
| Fork | Choice | Why |
|---|---|---|
| CONTRACT HTTP `/api/history/fetch` vs recovered worker | Kept recovered DB-claim + `history.pull.page` webhook | Satisfies LOGIC/DESIGN/ACs; reversible; least rewrite from approved closed PR |

## 5. Blockers
none for service PR. Baby Shiri switch stays off (babyshiri task).

## 6. Hebrew summary
שירות הוואטסאפ יודע למשוך היסטוריה לפי בקשה עם קצב בטוח.
היסטוריה אוטומטית במכשיר רגיל עדיין לא נשמרת.
המתג בארגון כבוי כברירת מחדל.
