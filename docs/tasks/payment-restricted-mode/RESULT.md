# RESULT — payment-restricted-mode

**Unblocked by Cowork — 2026-11-11.** Decision A accepted (D7): the restricted phase, public-page suspension and its notices get their own switch `payment_restricted_mode_go_live_at`. The existing `payment_enforcement_go_live_at` (live since 2026-09-20, verified by Cowork read-only) and its callers stay untouched; with the new switch absent, production behaviour is exactly today's (grace → blocked). Package updated: TASK Limits, LOGIC rule 3 + correction row, DECISIONS D4/D7, ACCEPTANCE AC-10/AC-11, RELEASE R4/go-live. STATE reset to `new`. Rerun the package from preflight.

**Status: BLOCKED.** Production already has an effective `payment_enforcement_go_live_at`. D4, LOGIC rule 3, AC-10 and RELEASE R4 assume the row is absent and use that absence to keep the new enforcement dormant until terms v2.

## Rerun preflight — 2026-11-11

A fresh read-only check still found one production row, and the production reader returned `2026-09-20 16:06:47.358553+00`. Staging still returned zero rows and a NULL effective value. The package still requires the production key to be absent. Implementation remains blocked on revising that activation requirement. This rerun made no changes to production or Staging.

## Round 0 — 2026-11-11

- Ran the preflight locally. The root checkout has unrelated changes. GitHub `main` was `04e8e646fc5c40b6f767ac656834db5351d0e178`.
- Read-only SQL at 01:31 Asia/Jerusalem on production project `dgxnnwnugdxzeopleera` found one config row. `public.payment_enforcement_go_live_at()` returned `2026-09-20 16:06:47.358553+00`. The live enforcement function calls that reader.
- The same read on Staging project `tyiylxtihzvxooecurwe` found no config row and a NULL effective value.
- The production aggregate matched the package's current status counts. It showed 58 exempt organizations, five paid, and zero grace or blocked. The past go-live value can affect a future failed charge even though the current aggregate has no grace or blocked organizations.
- Repository routes confirm that the Hub and client portal both expose payment entry points. When implementation resumes, suspension of public content needs coverage in both surfaces, with checkout and callback behavior verified independently.

## Acceptance

| AC | Result | Evidence |
|---|---|---|
| AC-10 | Blocked | Production has the setting and the live reader returns a timestamp in the past. Read-only checks verified both facts. |
| AC-01–09 | Pending | The go-live design needs to match the actual production baseline before implementation and Staging acceptance. |

## Decision needed

- **A — Recommended.** Approve a separate terms-v2 activation timestamp within the existing enforcement function. Preserve the current billing flag and its callers. Require the new timestamp for restricted mode, suspension of public pages, and their notices. Update D4, LOGIC rule 3, AC-10 and RELEASE R4 to verify absence of the new timestamp and a zero production status diff before activation.
- **B.** Keep the single flag and run a separately authorized production task to assess and reset the existing setting. The current enforcement function and billing notification code already read it. Verify the resulting behavior for current and future failed charges before starting this package again.

Files changed are this report and `STATE.json`. This was a read-only investigation of production and Staging. No implementation branch or PR was opened.

## Hebrew summary

בייצור נמצא מועד הפעלה קיים מ־20 בספטמבר 2026.
אם המצב המוגבל ישתמש באותו מועד, חיוב שלא שולם עלול להפעיל אותו לפני תנאי שימוש v2.
מומלץ לאשר מועד הפעלה נפרד לתנאים החדשים בתוך מנגנון האכיפה הקיים.

## Round 1 — 2026-11-11

**Status: BLOCKED on the WhatsApp service scope.** D7 resolves the Round 0 activation conflict. Production readback confirmed the new `payment_restricted_mode_go_live_at` key is absent and the existing `payment_enforcement_go_live_at` still reads `2026-09-20 16:06:47.358553+00`. Staging has neither timestamp set. No database or provider mutation was performed.

### Outbound coverage

- The package permits implementation in JumpStart and, for public content, Client Portal. `otomator-dev/REPOS.md:10` lists the production WhatsApp service as its own repository.
- Verified the WhatsApp upstream `master` and local tracking ref at `e5f29e0d9d0a5eecbdc8eb6d3ebd548f9f80bd47`. In that source, `src/routes/messages.ts` accepts queued sends. `src/pool/senderPool.ts:254` later sends the job directly through the provider, independent of the JumpStart Hub and Edge request that admitted it. `src/routes/groups.ts:311` also reaches the provider directly.
- The send-time policy in `src/lib/deviceSendPolicy.ts` reads the device's `listen_only` state. The pool rejects a failed job after it has removed that job from the queue. Using that policy for billing would discard jobs instead of holding and revalidating them under D6. A guard on the JumpStart Edge admission path alone cannot govern jobs already owned by the service.
- This is a release dependency for AC-05 and AC-07. Enabling the new Staging state before all required outbound paths can honor it would provide incomplete acceptance evidence. The routing and activation investigation is complete. No implementation PR or Staging migration was submitted.

| AC | Round 1 result | Evidence |
|---|---|---|
| AC-10 | Pass, preflight | Read-only production SQL verified absence of the new key and the existing value unchanged. |
| AC-05, AC-07 | Blocked | The independent provider send and queue failure paths require coverage in the WhatsApp service. |
| AC-01–04, AC-06, AC-08–09, AC-11 | Pending | Implementation and Staging acceptance remain pending. |

### Decision needed

- **A — Recommended.** Extend the package to `the-Otomator/jumpstart-whatsapp-service` for a separate PR and isolated Staging verification. Reuse the common org enforcement decision at send time, hold eligible queued jobs, and verify inbound traffic is preserved. Keep production activation under the separate terms-v2 release decision.
- **B.** Narrow the product acceptance criteria to queues and send paths owned by the JumpStart repositories and explicitly define the treatment of WhatsApp jobs the service already accepted.

D7 remains the approved activation design. The Round 0 recommendation about a separate activation timestamp is resolved.
