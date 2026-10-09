# PR task-link gate — manual release

Task: https://hub.jumpstart.co.il/tasks/table?task=12eb3b62-0af2-4c11-8b8b-4877bcc9de99

Every open PR to the configured production branch or `feature/*` must have `task-link` success from **otomator-release-gate**. The workflow runs from the PR base, checks out nothing, and supplies only repository/PR identity to release-ops. Release-ops independently reads the current PR through GitHub, parses exactly one canonical `Task:` line, and validates the structured record against the JumpStart project and non-archived task. Both workflow and server first post failure; errors never manufacture success or a `gone` outcome.

JumpStart `task_pull_requests` is the system of record. `(repo,number)` is unique; tasks may have many PRs. Manual link/unlink overrides future body imports, including an unlink tombstone. Link/create/unlink actions execute immediately through the App; no dispatch or hourly wait is needed. Concurrent pushes are rejected and re-evaluated by synchronize. The status targets the verified head SHA. A normal release sync imports bodies; the hourly gate sweep also repairs missed terminal events. Closed-without-merge and feature-branch merges remain visible on the task and prevent completion. Only all recorded PRs merged to their production branch complete the task.

## Required setup and release order (Nizan, separately authorized)

1. Review all six draft PRs. Preserve existing release-window/release-level/nightly-merge controls. These changes require `Release: manual`.
2. Verify the migration version reservation again, then submit the one JumpStart migration file through the production migration queue during the authorized window. Never apply it directly or run a broad migration push. The observed production max before implementation was `20271020100500`; the draft file is `20271020110000_task_pr_links.sql` and is not reserved/applied yet.
3. Verify **otomator-release-gate** (observed existing gate App ID `5162896`) is installed on all six repositories. Its installation needs commit statuses write and pull requests read. Restrict App credential access to trusted gate workflows and authorized server operators. In each repo, configure `APP_ID` and `APP_PRIVATE_KEY` in the new protected `task-link-gate` environment, retaining JumpStart's existing values. Restrict that environment to reviewed production/feature bases; exclude PR-head and other untrusted jobs. Use protected secret storage; no key goes in a PR, code, command output or report. The workflow checks the App slug before use. Required reviewers/branch policies must preserve that trust boundary; configuration is a human rollout prerequisite, not completed here.
4. In admin Edge Function secrets privately set `TASK_LINK_APP_ID` and `TASK_LINK_APP_PRIVATE_KEY` to the same App identity/key. These names were absent during preflight. No credential was created/copied by this task. Existing `JUMPSTART_SUPABASE_URL` and `JUMPSTART_SERVICE_ROLE_KEY` were present in the admin secret inventory; this implementation uses that existing server-only service-role bridge, never browser credentials. Existing internal-dispatch credentials remain untouched. Inventory presence does not prove value correctness: verify the bridge with authorized acceptance after the migration and release-ops deploy.
5. Merge/deploy the reviewed components only in the separately authorized release window. Deploy admin release-ops from the verified merged commit, then publish its frontend. No new JumpStart Edge Function is needed. Merge the gate workflows to production branches; seed existing feature bases with the trusted gate through reviewed work if those bases predate it. Do not execute PR-head YAML or code with secrets. Task 2 is separate and has not been started.
6. Observe real event/sweep statuses before requiring the context. Every repository uses the same App for task-link; other repositories' existing release-window/release-level GITHUB_TOKEN producers remain unchanged.

## Human branch-protection settings

Keep all existing protection and required checks. Add the exact required commit-status context **`task-link`**, selecting **otomator-release-gate** as its expected App/integration (ID `5162896`, verify at rollout), rather than accepting a status from any source. Require it for both the production branch and `feature/*`. Turn on include administrators/enforce admins and prohibit bypass for Nizan, agents, roles and Apps; rulesets must have no applicable bypass exemption. Retain reviews and other existing checks. Do not use bypass/admin merge.

| GitHub repository | Production branch | Additional target |
| --- | --- | --- |
| the-Otomator/jumpstartapp | main | feature/* |
| the-Otomator/otomator-admin | master | feature/* |
| the-Otomator/jumpstart-clientportal | main | feature/* |
| the-Otomator/jumpstart-whatsapp-service | master | feature/* |
| the-Otomator/jumpstart-finance | main | feature/* |
| the-Otomator/gesher | main | feature/* |

Nizan applies these settings; this task changed none. Existing JumpStart protection was read-only inspected: enforce_admins=true, required release-window bound to App ID 5162896. No merge-refusal proof is claimed before task-link is installed and made required.

## Side effects and rollback

The new link table has no outbound triggers. The RPC checks service role, validates the project/org, and exposes only task-visible rows to authenticated readers. Ordinary readers cannot mutate links or call the RPC. Creating tasks has no assignee. Creation fails closed if the Otomator org has active external task webhooks; automatic completion also fails closed if active task-status automations could send. The preflight observed zero active org webhooks/status rules. If these later change, investigate the visible safety-gate failure; never weaken the guard or silently suppress legitimate organization automations.

Rollback uses reviewed revert PRs and Nizan's normal release controls. Preserve existing PR/task records and approval history; do not delete the additive table or bypass required checks.

## Validation and pending live evidence

Local Deno tests mock GitHub and the bridge, covering canonical parsing, wrong origin/duplicate references, verified metadata, same-SHA statuses, concurrent pushes and store failures. Existing release-ops suites retain their checks. The PostgreSQL fixture in JumpStart executes the migration/RPC against PGlite and tests wrong-project/archive, unlink tombstones, multi-PR completion, feature merge and closed-unmerged exclusions, idempotent create, outbound guard, stale data and RLS/grants. Fixtures do not prove deployed credentials, live triggers, authenticated UI or production behavior.

Read-only backfill planner: `node scripts/pr-task-backfill.mjs <open-prs.json> <project-tasks.json>`. It refuses ambiguous references and performs no writes. A later authorized phase links unique candidates and lists every remaining unlinked PR. Match counts are projections, not executed backfill totals.

Pending separately authorized acceptance: taskless test PR failure/refused merge; same-SHA admin linking with measured delay; admin task creation with real task ID; actual production merge outcomes and task completion; authorized backfill readback. Never mark these as passed from local fixtures.
