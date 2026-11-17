-- Device sign-in codes live in a table only the device-auth Edge Function (service role) can touch:
-- RLS on with no policies, and no grants to anon/authenticated. (The private schema isn't reachable from
-- the function's REST client, so the table from the previous migration moves here.)
drop table if exists private.device_codes;
create table public.device_codes (
  device_code  text primary key,                     -- sha256 hex of the secret the TV holds
  user_code    text not null,
  platform     text not null check (platform in ('tvos', 'firetv', 'web', 'ios', 'android')),
  approved_by  uuid references auth.users (id) on delete cascade,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '10 minutes'
);
create unique index device_codes_user_code_idx on public.device_codes (user_code);
alter table public.device_codes enable row level security;
revoke all on public.device_codes from anon, authenticated;
