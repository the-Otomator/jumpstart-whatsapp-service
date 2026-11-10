# RESULT — QA 1 — Staging twin

**Status BLOCKED.** D-14 requires an Otomator-owned WhatsApp session available to JumpStart Staging. Neither Staging Otomator org has a registered device. Provisioning and verifying that specific session is the prerequisite for resuming.

## Scope and routing

Ran the preflight locally from the JumpStart checkout. The checkout has tracked and untracked changes. The remote branch lookup returned only main at 22af2e9f83418fd2e63547420e5e71ed83977469 for the three requested refs (main, staging, task feature branch). No existing task worktree appeared in the worktree list. Only this handoff and package state were edited.

## Evidence

- Supabase read-only transaction on JumpStart Staging returned 6 organizations, 174 cron definitions and 0 active cron jobs.
- A separate read-only count returned 4 rows in public.wa_devices, with 0 under either the Otomator synthetic twin or Otomator (Staging). This proves the missing registration on Staging. The upstream provider session inventory was not verified.
- A separate read-only count returned 0 rows in public.web_push_subscriptions. AC-05 also needs Nizan's test-device subscription.
- Staging function inventory returned 175 functions. The existing main source for whatsapp-otomator-send passes a caller-supplied session and recipient to its send adapter. The inventory and source review do not establish a Staging recipient guard or a safe delivery path.
- No Codex acceptance criterion completed. No browser journey, provider call, twin refresh, production query, credential change, cron enablement, or release was performed. No branch, PR, or preview was created.

## Blocker and resumption

- Recommended path. Register and verify Otomator's existing approved own-device session for use through the Staging-only send adapter. Also provision Nizan's test web-push subscription for AC-05.
- If the approved device has no usable session, provision a session on the approved Otomator-owned device and verify its ownership and Staging-only routing before attempting delivery.
- Verify the delivery controls and SUMIT test-terminal guard before enabling Staging jobs. Production release remains gated by Cowork PASS and Nizan's Release instruction. The package's emergency statement does not contain the canonical timestamped exception line.

## Package gaps

The package does not identify a verified Otomator-owned session binding on Staging or the test push subscription. Document where to verify those bindings without recording credential values. Clarify the required 24-hour observation in AC-07 versus the first 24-hour delivery report in RELEASE.md.

חבילת QA 1 נעצרה בבדיקת הפתיחה לפי D-14.
ב-Staging אין מכשיר WhatsApp רשום לאוטומטור ואין מנוי Push לבדיקה.
יש לאמת חיבור של המכשיר המאושר לפני חידוש הביצוע.

## Round 01 — FIX-01

**Current blocker: Staging has no scoped WhatsApp transport credential.** The device-selection blocker in the original report is superseded by FIX-01.

- A read-only production query scoped to the one approved device returned one row with a nonempty session reference. The reference value was neither retrieved nor recorded.
- Supabase secret inventory for Staging returned 13 entries and no WA_API_SECRET. Only names and presence were checked. No secret values were retrieved.
- The deployed Staging whatsapp-otomator-send requires WA_API_SECRET and forwards a caller-supplied recipient. Its waServiceFetch dependency enforces device and freeze policy but has no Staging recipient rewrite. The WhatsApp service origin/master at e5f29e0d9d0a5eecbdc8eb6d3ebd548f9f80bd47 uses shared bearer authentication for its /api routes. The send route selects a sender pool from the request. The reviewed transport offers no credential restricted to the approved session and Nizan.
- Installing the shared production credential would expose sending outside the approved scope. The package prohibits copying production credentials and requires a hard stop where real-person delivery is possible. No binding, test send, production write, cron enablement, or deployment was attempted.
- Push remains awaiting Nizan subscription under D-16, once the Staging URL is live. AC-07 is a two-hour build observation under D-17. The canonical off-window approval is present for the separate Release phase.
- No acceptance criteria passed in this round. No branch, PR or preview was created. Local changes are limited to RESULT.md and STATE.json. The task remains blocked on round 1.

### Resumption

Use an existing approved relay if its credential and egress can be verified as restricted to the approved Otomator session and Nizan. Otherwise, the recommended option is a separately authorized, production-side scoped relay with a Staging-only credential, fixed sender and fixed recipient. That requires a scope change because this package authorizes no production service write before Release. Resume with refusal checks before the authorized send.

### Package gaps — Round 01

FIX-01 identifies the device and session but does not identify a scoped relay or credential for reaching it. Record the approved binding and its enforcement point before resuming.

המכשיר המאושר נמצא ויש לו מזהה סשן.
ל־Staging אין הרשאת שליחה שמוגבלת למכשיר הזה ולניצן.
לא בוצעה שליחה, והמשך המשימה דורש נתיב שליחה מוגבל.
