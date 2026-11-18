-- Songs anyone can sing right now: a karaoke version built from a shared (open-licensed) recording.
-- Only track ids are exposed; the stems themselves stay behind the existing policies.
create or replace function public.ready_to_sing(p_limit integer default 24, p_offset integer default 0)
returns table (track_id uuid, processed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select k.track_id, max(k.created_at)
    from public.karaoke_analysis k join public.audio_assets a on a.id = k.source_asset_id
   where a.owner_id is null
   group by k.track_id
   order by max(k.created_at) desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
grant execute on function public.ready_to_sing to anon, authenticated;
