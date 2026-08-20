\set ON_ERROR_STOP on

insert into public.whatsapp_devices (session_key)
values ('non-admin-first-registration');

-- A non-admin service may fill each routing field once.
update public.whatsapp_devices
set webhook_url = 'https://example.test/functions/v1/wa-incoming'
where session_key = 'non-admin-first-registration';

update public.whatsapp_devices
set webhook_secret = 'local-regression-value'
where session_key = 'non-admin-first-registration';

do $$
begin
  begin
    update public.whatsapp_devices
    set webhook_url = 'https://different.example.test/hook'
    where session_key = 'non-admin-first-registration';
    raise exception 'expected established webhook_url replacement to fail';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    update public.whatsapp_devices
    set webhook_secret = 'different-local-regression-value'
    where session_key = 'non-admin-first-registration';
    raise exception 'expected established webhook_secret replacement to fail';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

select webhook_url
from public.whatsapp_devices
where session_key = 'non-admin-first-registration';
