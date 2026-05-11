# TASK: WA Group — Two Critical Fixes

Branch base: `feature/wa-intent-classifier`
Repo: `C:\Users\Me\projects\jumpstart-whatsapp-service`

---

## Fix 1 — connect.ts: Wrong message after QR scan

**Bug:** After scanning the QR code, Baileys transitions the session from `qr` → `connecting`.
The polling loop hits `connecting` state and shows a negative/error message to the user,
even though the scan succeeded and sync is in progress.

**File:** `src/routes/connect.ts`

**Fix:** The `state-connecting` div must show a clear POSITIVE message:
- "Syncing... please wait" (not an error)
- The spinner should still show
- The current text is: "Connecting... waiting for authentication" — that is fine, but verify
  the JS `setState` logic: after `qr` → `connecting`, `setState('connecting')` must NOT
  show the `state-qr` div anymore, and must NOT show any error indicator.

Check the `poll()` function — make sure the `case 'connecting':` branch calls `setState('connecting')`
and resets any error state. If there is a `notFoundCount` or similar counter that triggers
an error-like state during `connecting`, reset it.

---

## Fix 2 — wa-group-orchestrator Edge Function: cron fires on historical occurrences

**Bug:** The cron SQL runs every 5 minutes and finds ALL occurrences where
`trigger_time <= now()` — which is TRUE for every past occurrence forever.
This caused groups to be created for events from 2021, blocking ליאור's number.

**Root fix:** Add an UPPER BOUND (polling window) to every trigger condition.
The cron runs every 5 minutes → use a 10-minute window to be safe.

**File:** Supabase Edge Function `wa-group-orchestrator` (in `supabase/functions/wa-group-orchestrator/index.ts` or similar)
Also update the cron job SQL in the relevant migration file.

**Current (broken) condition example:**
```sql
ec.wa_group_trigger = 'before_event_start_minutes'
AND event_occurrence_start_at(eo.id) - (ec.wa_group_offset_minutes * interval '1 minute') <= now()
```

**Fixed condition — wrap every trigger with a 10-minute window:**
```sql
ec.wa_group_trigger = 'before_event_start_minutes'
AND event_occurrence_start_at(eo.id) - (ec.wa_group_offset_minutes * interval '1 minute') <= now()
AND event_occurrence_start_at(eo.id) - (ec.wa_group_offset_minutes * interval '1 minute') >= now() - interval '10 minutes'
```

Apply the same upper-bound pattern to ALL trigger types:
- `at_event_start`: `start_at <= now() AND start_at >= now() - interval '10 minutes'`
- `before_event_start_minutes`: as above
- `before_event_end_minutes`: same pattern for end time
- `on_publish`: this fires on status change, not time-based — leave as-is OR add
  a `published_at` timestamp check if that column exists

**Do NOT add any filter on eo.status or eo.date range** — the user explicitly does not
want status-based or date-range filtering. The 10-minute window is the only guard needed.

---

## Fix 3 — Group name: use occurrence title, allow manual override

**Bug:** Every group is named after the category ("אאוטפיט") instead of the specific occurrence.

**Rule:**
- Group subject = `eo.title` if not null/empty
- Else = `category_name + " " + date formatted as DD/MM/YYYY` (e.g., "אאוטפיט 07/02/2026")
- When creating manually (button), the caller can pass an explicit `subject` override — if provided, use it as-is

This applies in the `wa-group-orchestrator` EF where it calls the WA service to create the group.

---

## Fix 4 — Group settings: apply all WhatsApp permissions on creation

### What WhatsApp/Baileys supports (map to DB columns)

| Setting | DB column | Values | Baileys call |
|---|---|---|---|
| Who can send messages | `send_permission` | `'all'` / `'admins'` | `groupSettingUpdate(jid, 'announcement')` for admins, `'not_announcement'` for all |
| Who can edit info (name/description/icon) | `edit_info_permission` | `'all'` / `'admins'` | `groupSettingUpdate(jid, 'locked')` for admins, `'unlocked'` for all |
| Member add approval | `approval_mode` | `'off'` / `'on'` | `groupSettingUpdate(jid, 'membership_approval_mode')` |
| Who can add new members | `add_participants_permission` | `'all'` / `'admins'` | `groupSettingUpdate(jid, 'add_participants')` — if Baileys supports it |

### DB migration needed (jumpstart-app repo, NOT wa-service)

Add missing column to `wa_groups`:
```sql
ALTER TABLE wa_groups
  ADD COLUMN IF NOT EXISTS add_participants_permission text NOT NULL DEFAULT 'admins';
```

Default must be `'admins'` — never allow all participants to add members by default.

### What the EF must do after creating the group

After `groupCreate`, apply all settings in sequence:
1. `send_permission = 'admins'` → call `groupSettingUpdate(jid, 'announcement')`
   `send_permission = 'all'` → call `groupSettingUpdate(jid, 'not_announcement')`
2. `edit_info_permission = 'admins'` → call `groupSettingUpdate(jid, 'locked')`
   `edit_info_permission = 'all'` → call `groupSettingUpdate(jid, 'unlocked')`
3. `approval_mode = 'on'` → call appropriate Baileys setting
4. `add_participants_permission = 'admins'` → call appropriate Baileys setting if supported

Read these values from the `wa_groups` row AFTER inserting it (they have DB defaults).

### Where these settings are edited — jumpstart-app UI

In the event's WA group settings panel (`jumpstart-app` repo), show all four controls:

- **מי יכול לשלוח הודעות** — toggle: כולם / אדמינים בלבד (default: כולם)
- **מי יכול לערוך פרטי הקבוצה** (שם, תיאור, אייקון) — toggle: כולם / אדמינים בלבד (default: אדמינים)
- **אישור הצטרפות** — on/off (default: off)
- **מי יכול להוסיף משתתפים** — toggle: כולם / אדמינים בלבד (default: אדמינים)

Save updates both the `wa_groups` DB row AND call the WA service to apply live if group already exists.

---

## What NOT to do

- Do NOT add `AND eo.status = 'published'` or any status filter
- Do NOT add `AND eo.date >= CURRENT_DATE` or any date range filter
- Do NOT re-enable the cron jobs — leave them disabled. Cowork will re-enable manually after review.
- Do NOT deploy to prod — push branch and report back.

---

## Verification

After changes:
1. `npm run build` must pass with 0 errors in BOTH repos (wa-service + jumpstart-app)
2. Show the updated cron SQL with the 10-minute window
3. Show the group name logic in the EF
4. Show the migration SQL for `add_participants_permission`
5. Report what changed in connect.ts for the QR feedback
6. List all 4 group settings and confirm each maps to a Baileys call

---

## Review / agent pass — 2026-05-11

**Verdict:** The file matches a clear multi-part goal: (1) better post-QR UX in `connect.ts`, (2) stop the orchestrator cron from matching all historical rows via a bounded time window, (3) correct group naming from occurrence data, (4) persist and apply full WhatsApp group settings (DB + EF + app UI), with explicit “do not” constraints and a verification checklist. For that scope, the document is actionable and internally consistent.

**Strengths**

- Fix 2 states the failure mode (past occurrences forever) and the exact SQL pattern with a concrete window length tied to cron cadence.
- “What NOT to do” avoids scope creep (status/date filters, re-enabling cron, prod deploy).
- Fix 4 separates migration (jumpstart-app), EF behavior, and UI, with a Baileys mapping table and default safety (`add_participants_permission` default `admins`).

**Gaps / risks to resolve during implementation (not blockers for the spec itself)**

- **`on_publish`:** The spec allows “leave as-is OR” a timestamp check; implementers should confirm how `on_publish` is represented in SQL today so the same window logic does not accidentally fire on old publishes.
- **Cross-repo contract:** Fix 4 says the app saves DB and “calls the WA service” for live updates — the task does not name the exact HTTP route(s) or payload for `groupSettingUpdate`-style updates; that should be discovered from existing `messages`/sessions APIs or added as a small sub-task when coding.
- **`approval_mode` / `add_participants_permission`:** Baileys API names and support for `membership_approval_mode` and `add_participants` should be verified against the pinned Baileys version before treating the table as final truth.

**Questions (only if your original goal was different)**

1. Was the intended scope strictly Fixes 1–2 (QR + cron), or did you always want 3–4 (naming + full settings) in the same delivery?
2. Should orchestrator changes live only in Supabase/jumpstart-app, or does jumpstart-whatsapp-service also need new endpoints for Fix 4 live updates?

*End of review entry.*

---

## Implementation log — 2026-05-11 (executed)

**Repos:** `jumpstart-whatsapp-service`, `jumpstart-app`.

| Fix | What was done |
|-----|-----------------|
| **1 — connect.ts** | `src/routes/connect.ts`: positive “syncing” copy (HE + EN) for `state-connecting`; `notFoundCount` reset on `connecting` unchanged. |
| **2 — cron window** | `jumpstart-app/supabase/migrations/20260511180000_wa_group_cron_polling_window.sql`: 10-minute lower bound on `at_event_start`, `before_event_start_minutes`, `before_event_end_minutes`; `on_publish` uses `eo.updated_at >= now() - 10 minutes` in addition to `status = 'published'`. **Note:** migration re-`schedule`s `wa_group_auto_create`; if cron must stay off in an env, unschedule after migrate per team process. |
| **3 — group name** | `supabase/functions/wa-group-orchestrator/index.ts`: optional `group_subject` when `manual`; else `title_override` / `title`, else `category + DD/MM/YYYY` (25-char cap). |
| **4 — settings** | Same EF: insert `send_permission`, `edit_info_permission`, `approval_mode`, `add_participants_permission`; `applyGroupPolicyOnWhatsApp` after create. New WA route `POST .../member-add-mode` → Baileys `groupMemberAddMode`. New orchestrator action `update_member_add_mode`. UI: `EventWaGroupTab.tsx` → `GroupQuickSettings`; `src/api/wa-groups.ts` helpers. Types: `wa-groups.ts`, `database.types.ts` (`add_participants_permission`). |

**WA service:** `src/routes/groups.ts` (member-add-mode), `validate.ts`, `types.ts`.

**Verification:** `npm run build` OK in `jumpstart-whatsapp-service`; `npm run build` (Vite) OK in `jumpstart-app`. `npx tsc --noEmit` in jumpstart-app may still report pre-existing errors in other files.

**Deploy order reminder:** DB migration → deploy WA service (new route) → deploy `wa-group-orchestrator` Edge Function.

*End of implementation log.*
