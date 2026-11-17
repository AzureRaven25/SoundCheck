-- SoundCheck M3 · Throttle fix: reserve a provider slot only if the caller will actually wait for it.
-- v1 always advanced next_slot, so callers that then gave up ("busy") still consumed a slot and pushed
-- every later request further out: a burst of background artwork lookups could starve previews.

drop function if exists public.provider_reserve_slot(text);

-- Returns ms to sleep before the request (0 = go now), or -1 if the wait would exceed p_max_wait_ms
-- (nothing reserved; the caller should report "busy" and retry later).
create or replace function public.provider_reserve_slot(p_provider text, p_max_wait_ms integer default 5000) returns integer
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_now  timestamptz := clock_timestamp();
    v_row  private.provider_throttle;
    v_wait integer;
  begin
    select * into v_row from private.provider_throttle where provider = p_provider for update;
    if not found then
      return 0;
    end if;
    v_wait := greatest(0, ceil(extract(epoch from (v_row.next_slot - v_now)) * 1000))::integer;
    if v_wait > p_max_wait_ms then
      return -1;
    end if;
    update private.provider_throttle
       set next_slot = greatest(next_slot, v_now) + min_interval
     where provider = p_provider;
    return v_wait;
  end
  $$;

revoke all on function public.provider_reserve_slot(text, integer) from public, anon, authenticated;
grant execute on function public.provider_reserve_slot(text, integer) to service_role;
