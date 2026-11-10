# RELEASE — payment-restricted-mode

Run only on "Release the task package …", after merge, in the night window (or with an off-window line). **Does not turn it on.**

| Step | What must be true | Proof |
|---|---|---|
| R1 | Migrations submitted via `public.migration_queue_submit` and applied | queue rows + catalog readback |
| R2 | Edge Functions changed by the PR deployed from the merge SHA | versions |
| R3 | Hub (and clientportal if touched) production deploys succeeded | build ids |
| R3b | WhatsApp service deployed to wa-prod-1 from its merge SHA — **only after Nizan's explicit OK in chat** (WA infra = Nizan's ops); health 200 and queue draining normally | deploy output + `/health` + queue depth before/after |
| R4 | Production `payment_restricted_mode_go_live_at` still absent, `payment_enforcement_go_live_at` unchanged; all orgs' states identical to before (diff of the per-org status/reason list) | before/after diff |

## Go-live (separate, later)
Only when terms v2 takes effect and Nizan says so: set `system_config.payment_restricted_mode_go_live_at` = the terms effective time via the migration queue, then read back states.
