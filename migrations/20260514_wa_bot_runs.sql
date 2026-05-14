-- Migration: wa_bot_runs
-- Apply to: EACH tenant DB
-- WorkMatch: run on each tenant Supabase (e.g. vyeiujvcqvabexkjrhpa)
-- JumpStart: run on dgxnnwnugdxzeopleera
-- Depends: wa_conversations, wa_messages (TASK-05)

create table if not exists wa_bot_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  conversation_id   uuid references wa_conversations(id) on delete cascade,
  trigger_message_id uuid references wa_messages(id) on delete set null,
  model             text default 'gemini-2.0-flash',
  status            text default 'processing' check (status in ('processing','done','error')),
  prompt_tokens     int,
  completion_tokens int,
  tool_calls        jsonb,
  error             text,
  created_at        timestamptz default now()
);

create index if not exists idx_wa_bot_runs_conv
  on wa_bot_runs(conversation_id, created_at desc);

alter table wa_bot_runs enable row level security;
drop policy if exists "org_isolation" on wa_bot_runs;
create policy "org_isolation" on wa_bot_runs for all using (true);

-- NOTE for JumpStart (dgxnnwnugdxzeopleera):
-- Replace the policy above with the standard JumpStart RLS pattern:
--   drop policy if exists "org_isolation" on wa_bot_runs;
--   create policy "org_isolation" on wa_bot_runs for all
--     using (organization_id = (
--       select organization_id from users where auth_user_id = auth.uid()
--     ));
