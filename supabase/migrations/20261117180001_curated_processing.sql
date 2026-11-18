-- Curating shared karaoke versions of open-licensed songs (scripts/process_open_catalog.py, service role only).
create or replace function public.admin_request_processing(p_asset_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_asset public.audio_assets;
  v_job uuid;
  v_msg bigint;
begin
  select * into v_asset from public.audio_assets where id = p_asset_id and kind = 'original' and owner_id is null;
  if not found then raise exception 'shared original not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.karaoke_analysis where source_asset_id = p_asset_id) then return null; end if;
  select id into v_job from public.processing_jobs where asset_id = p_asset_id and status in ('queued', 'running');
  if v_job is not null then return v_job; end if;
  insert into public.processing_jobs (track_id, asset_id, requested_by) values (v_asset.track_id, v_asset.id, null) returning id into v_job;
  select pgmq.send('audio_processing', jsonb_build_object('job_id', v_job, 'asset_id', v_asset.id, 'track_id', v_asset.track_id,
                                                          'storage_path', v_asset.storage_path, 'external_url', v_asset.external_url))
    into v_msg;
  update public.processing_jobs set queue_msg_id = v_msg where id = v_job;
  return v_job;
end
$$;
revoke all on function public.admin_request_processing from public, anon, authenticated;
grant execute on function public.admin_request_processing to service_role;

-- "Ready to sing" means there are words to sing: published lyrics for the track, or lyrics timed/transcribed on the analysis
create or replace function public.ready_to_sing(p_limit integer default 24, p_offset integer default 0)
returns table (track_id uuid, processed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select k.track_id, max(k.created_at)
    from public.karaoke_analysis k join public.audio_assets a on a.id = k.source_asset_id
   where a.owner_id is null
     and (k.word_lyrics is not null or exists (select 1 from public.lyrics l where l.track_id = k.track_id))
   group by k.track_id
   order by max(k.created_at) desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
