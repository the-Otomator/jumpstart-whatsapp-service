# RELEASE — wa-history-pull

Run only on "Release the task package …", after Nizan merged the PR(s). Night window rules of each repo apply.

| Step | What must be true | Proof |
|---|---|---|
| R1 | Migration(s) submitted via `public.migration_queue_submit` with task `c5076c18-38a0-428f-956e-52631aba185b` and applied by the runner | queue state + `select` of new objects; switch off for every org |
| R2 | Edge Function(s) changed by the PR (incl. `wa-webhook`) deployed from the merge commit | deploy output + version |
| R3 | WhatsApp service deployed from its merge commit on wa-prod-1; `/health` ok; all previously connected devices reconnect | health + device statuses before/after |
| R4 | Switch on for Otomator org only; one button pull on one of Nizan's own private chats on device "ניצן - פרטי" (`84920ad6-…`) | AC-21 SQL; nothing sent |
| R5 | Hub production deploy contains the button (live bundle string check) | bundle grep |
| R6 | Switch on for Baby Shiri (`8e93d62f-…`) with its audience rule; start the sweep; report per-state counts when it settles | AC-22 SQL |
| R7 | Switch for Otomator org back off unless Nizan asked to keep it | row value |

If any step fails: stop, put it at the top of RESULT "Release" with the merge commits and a one-line revert plan. Never revert without Nizan.
