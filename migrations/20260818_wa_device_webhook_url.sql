-- Authoritative per-device inbound webhook routing for the Otomator Hub registry.
-- Apply to project mzalzjtsyrjycaxolldv only. Backfill is generated separately.

alter table public.whatsapp_devices
  add column if not exists webhook_url text;

alter table public.whatsapp_devices
  drop constraint if exists whatsapp_devices_webhook_url_http_check;

alter table public.whatsapp_devices
  add constraint whatsapp_devices_webhook_url_http_check
  check (webhook_url is null or webhook_url ~ '^https?://[^[:space:]]+$');

comment on column public.whatsapp_devices.webhook_url is
  'Authoritative absolute HTTP(S) target for inbound events from this device session.';

alter table public.whatsapp_devices enable row level security;

-- Keep the existing public portal insert policy, but only authenticated admins may
-- provide the sensitive routing target. Anonymous/non-admin inserts must leave it null.
drop policy if exists whatsapp_devices_insert_portal on public.whatsapp_devices;
create policy whatsapp_devices_insert_portal
  on public.whatsapp_devices
  for insert
  to anon, authenticated
  with check (
    webhook_url is null
    or exists (
      select 1
      from public.admin_users
      where lower(email) = lower(auth.email())
    )
  );

drop policy if exists whatsapp_devices_update_webhook_admin on public.whatsapp_devices;
create policy whatsapp_devices_update_webhook_admin
  on public.whatsapp_devices
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users
      where lower(email) = lower(auth.email())
    )
  )
  with check (
    exists (
      select 1
      from public.admin_users
      where lower(email) = lower(auth.email())
    )
  );

-- Existing authenticated/anon UPDATE grants were table-wide but had no matching
-- policy. Narrow them before enabling the admin policy so it can update only this
-- routing column and does not accidentally open writes to other device fields.
revoke update on public.whatsapp_devices from anon, authenticated;
grant update (webhook_url) on public.whatsapp_devices to authenticated;

-- Keep service_role writes durable as the table gains columns. A trigger guards the
-- sensitive routing target without turning the current column list into a grant snapshot.
grant select, insert, update on public.whatsapp_devices to service_role;

create or replace function public.whatsapp_devices_guard_webhook_url()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  table_owner name;
  caller_is_admin boolean;
begin
  if tg_op = 'INSERT' then
    if new.webhook_url is null then
      return new;
    end if;
  elsif new.webhook_url is not distinct from old.webhook_url then
    return new;
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner)
  into table_owner
  from pg_catalog.pg_class c
  where c.oid = 'public.whatsapp_devices'::regclass;

  -- SECURITY DEFINER makes current_user the function owner, so session_user is
  -- required here to identify a direct postgres/table-owner maintenance session.
  if session_user = 'postgres' or session_user = table_owner then
    return new;
  end if;

  select exists (
    select 1
    from public.admin_users
    where pg_catalog.lower(email) = pg_catalog.lower(auth.email())
  )
  into caller_is_admin;

  if not caller_is_admin then
    raise exception using
      errcode = '42501',
      message = case
        when tg_op = 'INSERT' then
          'whatsapp_devices.webhook_url may only be set by an authenticated admin or database owner'
        else
          'whatsapp_devices.webhook_url may only be changed by an authenticated admin or database owner'
      end;
  end if;

  return new;
end;
$$;

revoke all on function public.whatsapp_devices_guard_webhook_url() from public;
revoke execute on function public.whatsapp_devices_guard_webhook_url() from anon;
revoke execute on function public.whatsapp_devices_guard_webhook_url() from authenticated;
revoke execute on function public.whatsapp_devices_guard_webhook_url() from service_role;

drop trigger if exists whatsapp_devices_guard_webhook_url
  on public.whatsapp_devices;
create trigger whatsapp_devices_guard_webhook_url
  before insert or update on public.whatsapp_devices
  for each row
  execute function public.whatsapp_devices_guard_webhook_url();
