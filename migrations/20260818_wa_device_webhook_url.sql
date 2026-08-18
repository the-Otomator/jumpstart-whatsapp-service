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

-- The WA service uses service_role to read the registry and to write operational
-- status fields. Replace its table-wide writes with column grants that exclude
-- webhook_url, so the service key cannot alter routing while status writes continue.
grant select on public.whatsapp_devices to service_role;
revoke insert, update on public.whatsapp_devices from service_role;

do $$
declare
  writable_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into writable_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'whatsapp_devices'
    and column_name <> 'webhook_url';

  if writable_columns is null then
    raise exception 'whatsapp_devices writable columns not found';
  end if;

  execute format(
    'grant insert (%s) on public.whatsapp_devices to service_role',
    writable_columns
  );
  execute format(
    'grant update (%s) on public.whatsapp_devices to service_role',
    writable_columns
  );
end
$$;
