-- Sing history: every song someone starts singing on Stage, whether or not it ends in a score (leaving early,
-- restarting, a song without synced lyrics). "Songs sung" counts these, so the stat matches what people did.
create table public.sing_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id       uuid not null references public.tracks (id) on delete cascade,
  mode           text not null check (mode in ('melody', 'lyrics')),
  party          boolean not null default false,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  sung_seconds   integer not null default 0 check (sung_seconds between 0 and 7200),   -- time the mic heard singing
  performance_id uuid references public.performances (id) on delete set null
);
create index sing_sessions_user_idx on public.sing_sessions (user_id, started_at desc);
alter table public.sing_sessions enable row level security;
create policy "read own sing history" on public.sing_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy "start own sing session" on public.sing_sessions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own sing session" on public.sing_sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own sing history" on public.sing_sessions for delete to authenticated using (user_id = (select auth.uid()));
-- a session links only to the singer's own performance
create or replace function private.sing_session_own_performance() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.performance_id is not null and not exists (select 1 from public.performances p where p.id = new.performance_id and p.user_id = new.user_id) then
    new.performance_id := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger sing_session_own_performance before insert or update on public.sing_sessions
  for each row execute function private.sing_session_own_performance();

-- Stats: songs sung = sessions with at least 20 s of singing, or scored performances, whichever is more (scores
-- from before sing history existed still count).
drop function if exists public.my_stats();
create or replace function public.my_stats()
returns table (performances bigint, tracks_sung bigint, avg_score real, best_score smallint,
               avg_pitch real, avg_timing real, avg_rhythm real, avg_stability real, achievements bigint,
               songs_sung bigint, minutes_sung integer)
language sql stable security invoker set search_path = ''
as $$
  with p as (
    select count(*) n, count(distinct track_id) t, avg(score)::real a, max(score) b,
           avg(pitch_score)::real ap, avg(timing_score)::real at, avg(rhythm_score)::real ar, avg(stability_score)::real ast
      from public.performances where user_id = (select auth.uid())
  ), s as (
    select count(*) filter (where sung_seconds >= 20) n, coalesce(sum(sung_seconds), 0) secs
      from public.sing_sessions where user_id = (select auth.uid())
  )
  select p.n, p.t, p.a, p.b, p.ap, p.at, p.ar, p.ast,
         (select count(*) from public.user_achievements ua where ua.user_id = (select auth.uid())),
         greatest(p.n, s.n), (s.secs / 60)::integer
    from p, s
$$;
grant execute on function public.my_stats() to authenticated;
revoke execute on function public.my_stats() from anon, public;
