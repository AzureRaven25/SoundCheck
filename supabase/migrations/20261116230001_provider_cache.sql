-- SoundCheck M2 · Provider lookup cache + throttle state (service role only).
--
-- Edge Functions record every external lookup (MusicBrainz, Cover Art Archive, iTunes, LRCLIB)
-- here so the same query isn't repeated (including "not found" answers) and so MusicBrainz's
-- 1 request/second limit holds across concurrent function instances.

create table private.provider_cache (
  provider    text not null check (provider in ('musicbrainz', 'coverartarchive', 'itunes', 'lrclib', 'spotify_oembed')),
  key         text not null,
  status      text not null check (status in ('hit', 'miss', 'error')),
  value       jsonb,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  primary key (provider, key)
);
create index provider_cache_expiry_idx on private.provider_cache (expires_at);
alter table private.provider_cache enable row level security;  -- no policies: service role only
revoke all on private.provider_cache from anon, authenticated;

-- Global per-provider throttle: returns how many ms the caller must wait before its request.
create table private.provider_throttle (
  provider     text primary key,
  min_interval interval not null,
  next_slot    timestamptz not null default now()
);
alter table private.provider_throttle enable row level security;
revoke all on private.provider_throttle from anon, authenticated;
insert into private.provider_throttle (provider, min_interval) values
  ('musicbrainz', interval '1100 milliseconds'),
  ('itunes', interval '3 seconds'),
  ('coverartarchive', interval '200 milliseconds'),
  ('lrclib', interval '200 milliseconds');

-- Reserve the next request slot atomically; returns milliseconds to sleep (0 = go now).
create or replace function public.provider_reserve_slot(p_provider text) returns integer
  language plpgsql security definer set search_path = ''
  as $$
  declare v_slot timestamptz;
  begin
    update private.provider_throttle
       set next_slot = greatest(next_slot, clock_timestamp()) + min_interval
     where provider = p_provider
     returning next_slot - min_interval into v_slot;
    if v_slot is null then
      return 0;
    end if;
    return greatest(0, ceil(extract(epoch from (v_slot - clock_timestamp())) * 1000))::integer;
  end
  $$;

create or replace function public.provider_cache_get(p_provider text, p_key text)
returns table (status text, value jsonb)
  language sql stable security definer set search_path = ''
  as $$
    select c.status, c.value from private.provider_cache c
    where c.provider = p_provider and c.key = p_key and c.expires_at > now()
  $$;

create or replace function public.provider_cache_put(p_provider text, p_key text, p_status text, p_value jsonb, p_ttl_seconds integer)
returns void
  language sql security definer set search_path = ''
  as $$
    insert into private.provider_cache (provider, key, status, value, fetched_at, expires_at)
    values (p_provider, p_key, p_status, p_value, now(), now() + make_interval(secs => p_ttl_seconds))
    on conflict (provider, key) do update
      set status = excluded.status, value = excluded.value, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
  $$;

revoke all on function public.provider_reserve_slot, public.provider_cache_get, public.provider_cache_put
  from public, anon, authenticated;
grant execute on function public.provider_reserve_slot, public.provider_cache_get, public.provider_cache_put to service_role;
