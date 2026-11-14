# ACCEPTANCE — qa-dept-1-staging-twin

| AC | Owner | Env | Check | Expected | Evidence |
|---|---|---|---|---|---|
| AC-01 | Codex | staging | Open `staging.hub.jumpstart.co.il` (or D-09 alias) | Serves the exact `staging` HEAD SHA; banner visible; zero production origins in network log | SHA readback + HAR summary + screenshot |
| AC-02 | Codex | staging DB | Twin refresh run #1 and #2 | Org count = production org count; per-org table counts match production; safety report all zeros (real phones/emails outside allowlist, tokens, prod hosts) | Two safety reports, identical digests |
| AC-03 | Codex | staging DB | Sample 50 random contacts across orgs vs production (read-only) | No name/phone/email/free-text equals production | Query output (hashes only) |
| AC-04 | Codex | staging | Landing/class/event pages of Tnuatef + Baby Shiri twins | Render with real structure, prices, schedules, logos | Screenshots |
| AC-05 | Codex | staging | Fire one automation per channel | Each really delivered to Nizan's phone/email with `[QA · org]` prefix and correct body; log has provider id + delivered | Delivery log rows |
| AC-06 | Codex | staging | Force a send with a non-Nizan destination and with the rewrite disabled, per channel | Refused, logged, nothing delivered | Refusal rows + provider shows no call |
| AC-06b | Codex | staging | Try to load a live SUMIT / customer WA credential on Staging | Refused at startup | Log |
| AC-07 | Codex | staging | Crons enabled after AC-05/06 | 2h (D-17): zero deliveries to any destination except Nizan; cap respected | Delivery log counts |
| AC-08 | Codex | staging + prod | QA one-time login per role | Works on Staging once, expires in 10 min, second use refused; same call on production refused | Run log per role |
| AC-14 | Codex | repo | All repo checks + existing tests | Green, no new failures vs baseline | Check links |
| AC-15 | Cowork | staging | Walk end customer + instructor + public signup on staging as QA identities | Works; sink shows messages | Cowork VERIFY.md |
| AC-16 | Cowork | DB read | Re-run AC-03 style leak query independently | Zero leaks | Query in VERIFY.md |
| AC-18 | Nizan | staging | Open staging address, log in as Tnuatef-twin instructor via admin link, look at the day screen | "It works like production, with fake people" | His OK |
