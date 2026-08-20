-- Split per-device webhook credentials from the publicly readable routing URL.
-- Apply to project mzalzjtsyrjycaxolldv only, after Otomator Admin no longer
-- selects whatsapp_devices with `*`. Backfill is generated separately.

alter table public.whatsapp_devices
  add column if not exists webhook_secret text;

comment on column public.whatsapp_devices.webhook_secret is
  'Server-only query-string secret appended as `secret` when dispatching to webhook_url.';

-- A column revoke cannot override the existing table-level SELECT grant. Replace
-- that broad grant with per-column grants for every current non-secret column so
-- anon/authenticated retain the same public registry visibility without the secret.
revoke select (webhook_secret)
  on public.whatsapp_devices
  from anon, authenticated;
revoke select on public.whatsapp_devices from anon, authenticated;

do $$
declare
  public_columns text;
begin
  select pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum)
  into public_columns
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.whatsapp_devices'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> 'webhook_secret';

  if public_columns is not null then
    execute pg_catalog.format(
      'grant select (%s) on public.whatsapp_devices to anon, authenticated',
      public_columns
    );
  end if;
end;
$$;

-- The service uses this role for registry lookup and must retain full-column SELECT.
grant select on public.whatsapp_devices to service_role;

-- Preserve the URL-only shape check from 20260818_wa_device_webhook_url.sql.
-- webhook_secret is intentionally unconstrained: it is an opaque credential, not a URL.
alter table public.whatsapp_devices
  drop constraint if exists whatsapp_devices_webhook_url_http_check;

alter table public.whatsapp_devices
  add constraint whatsapp_devices_webhook_url_http_check
  check (webhook_url is null or webhook_url ~ '^https?://[^[:space:]]+$');

create or replace function public.whatsapp_devices_guard_webhook_url()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  caller_is_admin boolean;
  replacing_webhook_url boolean;
  replacing_webhook_secret boolean;
begin
  -- INSERT and NULL -> value are first-time registration. RLS and column grants
  -- remain responsible for deciding which callers may reach those transitions.
  if tg_op = 'INSERT' then
    return new;
  end if;

  replacing_webhook_url :=
    old.webhook_url is not null
    and new.webhook_url is distinct from old.webhook_url;
  replacing_webhook_secret :=
    old.webhook_secret is not null
    and new.webhook_secret is distinct from old.webhook_secret;

  if not replacing_webhook_url and not replacing_webhook_secret then
    return new;
  end if;

  -- SECURITY DEFINER makes current_user the function owner, so session_user is
  -- required here to identify a direct postgres maintenance session.
  if session_user = 'postgres' then
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
        when replacing_webhook_url and replacing_webhook_secret then
          'established whatsapp_devices webhook_url and webhook_secret may only be changed by an authenticated admin or postgres'
        when replacing_webhook_url then
          'established whatsapp_devices.webhook_url may only be changed by an authenticated admin or postgres'
        else
          'established whatsapp_devices.webhook_secret may only be changed by an authenticated admin or postgres'
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
