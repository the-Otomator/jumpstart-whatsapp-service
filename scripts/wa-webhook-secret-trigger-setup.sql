\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role webhook_route_tester login password 'local-test-only';
create role webhook_anon_reader login password 'local-test-only';
grant anon to webhook_anon_reader;

create schema auth;
create function auth.email()
returns text
language sql
stable
as $$ select null::text $$;

create table public.admin_users (email text);
create table public.whatsapp_devices (
  id bigint generated always as identity primary key,
  session_key text not null unique,
  webhook_url text
);

grant insert, update, select on public.whatsapp_devices to webhook_route_tester;
grant usage, select on sequence public.whatsapp_devices_id_seq to webhook_route_tester;
