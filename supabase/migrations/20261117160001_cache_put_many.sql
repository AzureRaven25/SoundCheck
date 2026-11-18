-- Write many cache entries in one round trip (acquire caches every search result for later imports).
create or replace function public.provider_cache_put_many(p_provider text, p_items jsonb, p_ttl_seconds integer)
returns void
  language sql security definer set search_path = ''
  as $$
    insert into private.provider_cache (provider, key, status, value, fetched_at, expires_at)
    select p_provider, i->>'key', 'hit', i->'value', now(), now() + make_interval(secs => p_ttl_seconds)
      from jsonb_array_elements(p_items) i
     where i->>'key' is not null
    on conflict (provider, key) do update
      set status = excluded.status, value = excluded.value, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
  $$;
revoke all on function public.provider_cache_put_many from public, anon, authenticated;
grant execute on function public.provider_cache_put_many to service_role;
