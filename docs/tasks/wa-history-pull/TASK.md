# TASK — WhatsApp history pull (up to 30 days back) per chat + Baby Shiri sweep + "load earlier messages" button

Run under the "Cowork task packages" protocol in this repo's AGENTS.md. Do not ask questions; hard stops only.

| | |
|---|---|
| Slug | `wa-history-pull` |
| Dev task | `c5076c18-38a0-428f-956e-52631aba185b` — "בייבי שירי — משיכת היסטוריית וואטסאפ (חודש אחורה) ללקוחות ולידים + כפתור "טען הודעות קודמות"" (PR body line: `Task: jumpstart-task c5076c18-38a0-428f-956e-52631aba185b`) |
| Repo(s) | `jumpstart-whatsapp-service` (service PR) · `jumpstartapp` (Hub + Edge/DB PR(s); keep server/DB work out of the UI PR per release levels) |
| Branch | `feature/wa-history-pull` from `origin/main` in each repo |
| Worktree | `C:\Users\Me\projects\<repo>\.worktrees\wa-history-pull` |
| Package | `C:\Users\Me\projects\jumpstart\_tasks\wa-history-pull\` |
| Test environment | Default-off per-org switch. Off for every org. Codex proves logic with tests + preview UI; real end-to-end runs only in RELEASE, first on Nizan's own device in his own org, then Baby Shiri |
| Test user | Nizan's own user in his own org (Otomator) — never switch orgs |

## Goal — what is true when this is done
1. For an org with the switch on, a private WhatsApp chat that has at least one saved message can be filled with its earlier messages from the customer's phone — both sides of the conversation — going back at most 30 days from the moment of the pull.
2. Pulled history shows in the Hub chat (contact card + WhatsApp inbox) in the right order, linked to the right contact, and never fires anything: no bot, journey, consent/opt-out, trigger, notification, unread count, transcription, intelligence, portal event.
3. For Baby Shiri, a sweep pulls history for every chat of its audience (LOGIC §Audience) that has an anchor, and any audience chat that gets its first saved message later is pulled once automatically.
4. A "טען הודעות קודמות" button at the top of the chat lets a user pull on demand, with clear states (DESIGN.html).

## In scope
- WhatsApp service: on-demand history request for one chat; persisting the on-demand result (today it is dropped unless the device is listen-only).
- Inbound pipeline (`wa-webhook` + `_shared/waLog.ts`): accept on-demand history in both directions as backfill, with zero downstream side effects.
- Minimal state: per-org switch + audience rule, per-conversation pull state (so nothing is pulled twice, progress is visible, the sweep is resumable).
- Server entry point the Hub calls (the Hub never talks to the service directly).
- Sweep for Baby Shiri + auto-pull on first anchor.
- Hub button + states.

## Out of scope (do not touch)
- Full re-link / QR history sync, listen-only behaviour, `observed` rows and their training use.
- Storing replies the business types on its own phone in live traffic (separate finding, separate task).
- WhatsApp chat-export import; Meta Cloud / coexistence history.
- Groups (private chats only).
- Any change to logging settings of any org (`wa_logging_settings`).

## Source of truth
- Look: `DESIGN.html` (2026-10-26)
- Behaviour: `LOGIC.md`
- Forks: `DECISIONS.md`
- Done: `ACCEPTANCE.md`
- After merge: `RELEASE.md`

## Authorized now
Worktrees, branches, commits, push, PR (open/update) in both repos, branch preview builds, read-only production queries.
Everything else is forbidden — including deploying the WhatsApp service, deploying Edge Functions, submitting/applying migrations, turning the switch on for any org, and calling the history request against any real device.

## Limits
- Do not touch `src/lib/supabase.ts`, `src/store/authStore.ts`, `src/api/auth.ts`.
- Never send a WhatsApp message, never mark a message read, never change device connection state.
- Fail closed: switch missing/off, org mismatch, device not connected, no anchor → no request to the phone.
- New tables/RPCs follow the repo DB rules (organization_id, RLS, explicit grants, SECURITY DEFINER revokes) — migrations go in the PR only; RELEASE submits them to the queue.

## Definition of done
All Codex ACs pass with evidence · preview builds and shows the design states · PRs open with the task line (`Release: manual` in the server/DB PR body) · `RESULT.md` written · `STATE.json` phase `ready_for_cowork`.
