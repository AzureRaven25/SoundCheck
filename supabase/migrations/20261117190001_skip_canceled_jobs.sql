-- A canceled job's queue message is archived instead of being handed to a worker.
create or replace function public.worker_claim_jobs(p_worker text, p_visibility_seconds integer default 900, p_qty integer default 1)
returns table (msg_id bigint, read_ct integer, job jsonb)
language plpgsql security definer set search_path = ''
as $$
declare r record; v_status text;
begin
  for r in select * from pgmq.read('audio_processing', p_visibility_seconds, p_qty) loop
    select status into v_status from public.processing_jobs where id = (r.message ->> 'job_id')::uuid;
    if v_status is null or v_status in ('canceled', 'done') then
      perform pgmq.archive('audio_processing', r.msg_id);
      continue;
    end if;
    update public.processing_jobs
       set status = 'running', started_at = coalesce(started_at, now()), attempts = attempts + 1, worker = p_worker
     where id = (r.message ->> 'job_id')::uuid and status in ('queued', 'running');
    msg_id := r.msg_id; read_ct := r.read_ct; job := r.message;
    return next;
  end loop;
end
$$;
