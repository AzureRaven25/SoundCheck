-- Is anything processing karaoke right now? Workers check in about once a minute; users see the queue state.
create table private.worker_heartbeats (
  worker  text primary key,
  seen_at timestamptz not null default now()
);
alter table private.worker_heartbeats enable row level security;  -- service role only

create or replace function public.worker_heartbeat(p_worker text)
returns void language sql security definer set search_path = ''
as $$
  insert into private.worker_heartbeats (worker, seen_at) values (left(p_worker, 200), now())
  on conflict (worker) do update set seen_at = now();
  delete from private.worker_heartbeats where seen_at < now() - interval '1 day';
$$;
revoke all on function public.worker_heartbeat from public, anon, authenticated;
grant execute on function public.worker_heartbeat to service_role;

-- online: a worker checked in within 3 minutes. ahead: queued jobs created before this job (null without one).
create or replace function public.processing_status(p_job_id uuid default null)
returns table (online boolean, workers integer, queued integer, running integer, ahead integer)
language sql stable security definer set search_path = ''
as $$
  select
    exists (select 1 from private.worker_heartbeats where seen_at > now() - interval '3 minutes'),
    (select count(*)::int from private.worker_heartbeats where seen_at > now() - interval '3 minutes'),
    (select count(*)::int from public.processing_jobs where status = 'queued'),
    (select count(*)::int from public.processing_jobs where status = 'running'),
    case when p_job_id is null then null else
      (select count(*)::int from public.processing_jobs q
        where q.status = 'queued' and q.created_at < (select created_at from public.processing_jobs where id = p_job_id)) end
$$;
grant execute on function public.processing_status to anon, authenticated;
