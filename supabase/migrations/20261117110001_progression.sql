-- SoundCheck progression: XP and levels, daily streaks, and daily/weekly challenges.
-- Everything is awarded by triggers on performances (written only by score-performance), so it can't be faked.

-- ---------------------------------------------------------------- XP and levels
alter table public.profiles add column xp integer not null default 0 check (xp >= 0);

create table public.xp_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  amount         integer not null check (amount > 0),
  reason         text not null,                  -- 'performance' | 'new_song' | 'challenge:<id>'
  performance_id uuid references public.performances (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index xp_events_user_idx on public.xp_events (user_id, created_at desc);
create index xp_events_perf_idx on public.xp_events (performance_id);
alter table public.xp_events enable row level security;
create policy "see own xp" on public.xp_events for select to authenticated using (user_id = (select auth.uid()));

-- level n needs 100·(n−1)² XP: 1 → 0, 2 → 100, 3 → 400, 5 → 1,600, 10 → 8,100
create or replace function public.level_for_xp(p_xp integer) returns integer
  language sql immutable set search_path = '' as $$ select floor(sqrt(greatest(p_xp, 0) / 100.0))::integer + 1 $$;

create or replace function private.grant_xp(p_user uuid, p_amount integer, p_reason text, p_perf uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v_level integer;
  begin
    if p_amount <= 0 then return; end if;
    insert into public.xp_events (user_id, amount, reason, performance_id) values (p_user, p_amount, p_reason, p_perf);
    update public.profiles set xp = xp + p_amount where id = p_user returning public.level_for_xp(xp) into v_level;
    if v_level >= 5 then insert into public.user_achievements (user_id, achievement_id, performance_id) values (p_user, 'level_5', p_perf) on conflict do nothing; end if;
    if v_level >= 10 then insert into public.user_achievements (user_id, achievement_id, performance_id) values (p_user, 'level_10', p_perf) on conflict do nothing; end if;
  end
  $$;

-- ---------------------------------------------------------------- streaks (UTC days with at least one song)
create or replace function private.streaks(p_user uuid, out current_streak integer, out best_streak integer)
  language sql stable security definer set search_path = ''
  as $$
    with days as (select distinct (created_at at time zone 'UTC')::date d from public.performances where user_id = p_user),
    runs as (select d, d - (row_number() over (order by d))::integer grp from days),
    spans as (select min(d) s, max(d) e, count(*)::integer n from runs group by grp)
    select coalesce((select n from spans where e >= (now() at time zone 'UTC')::date - 1 order by e desc limit 1), 0),
           coalesce((select max(n) from spans), 0)
  $$;

-- ---------------------------------------------------------------- challenges
create table public.challenges (
  id          text primary key,                  -- e.g. 'd-2026-11-17', 'w-2026-11-16'
  kind        text not null check (kind in ('daily', 'weekly')),
  starts_on   date not null,
  ends_on     date not null,
  goal        text not null check (goal in ('songs', 'score_at_least', 'grade_a_songs', 'pitch_at_least', 'new_songs')),
  target      integer not null check (target > 0),
  threshold   integer,                           -- e.g. the score / pitch % to reach
  title       text not null,
  xp_reward   integer not null check (xp_reward > 0)
);
alter table public.challenges enable row level security;
create policy "challenges are public" on public.challenges for select to anon, authenticated using (true);

create table public.challenge_completions (
  user_id       uuid not null references auth.users (id) on delete cascade,
  challenge_id  text not null references public.challenges (id) on delete cascade,
  completed_at  timestamptz not null default now(),
  primary key (user_id, challenge_id)
);
alter table public.challenge_completions enable row level security;
create policy "see own completions" on public.challenge_completions for select to authenticated using (user_id = (select auth.uid()));

-- Today's and this week's challenges, created on first use (rotating deterministically by date).
create or replace function private.ensure_challenges() returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    today date := (now() at time zone 'UTC')::date;
    monday date := today - ((extract(isodow from today))::integer - 1);
    d integer := (today - date '2026-01-01') % 4;
    w integer := ((monday - date '2026-01-05') / 7) % 3;
  begin
    insert into public.challenges (id, kind, starts_on, ends_on, goal, target, threshold, title, xp_reward)
    select 'd-' || today, 'daily', today, today, x.goal, x.target, x.threshold, x.title, x.xp
    from (values
      (0, 'songs', 2, null::integer, 'Sing 2 songs today', 40),
      (1, 'score_at_least', 1, 80, 'Score 80 or more on any song', 50),
      (2, 'pitch_at_least', 1, 85, 'Hit 85% pitch accuracy on a song', 50),
      (3, 'new_songs', 1, null::integer, 'Sing a song you’ve never sung before', 40)
    ) x(n, goal, target, threshold, title, xp) where x.n = abs(d)
    on conflict (id) do nothing;
    insert into public.challenges (id, kind, starts_on, ends_on, goal, target, threshold, title, xp_reward)
    select 'w-' || monday, 'weekly', monday, monday + 6, x.goal, x.target, x.threshold, x.title, x.xp
    from (values
      (0, 'songs', 10, null::integer, 'Sing 10 songs this week', 150),
      (1, 'grade_a_songs', 3, null::integer, 'Earn an A or better on 3 songs this week', 200),
      (2, 'new_songs', 5, null::integer, 'Sing 5 different songs this week', 150)
    ) x(n, goal, target, threshold, title, xp) where x.n = abs(w)
    on conflict (id) do nothing;
  end
  $$;

create or replace function private.challenge_progress(p_user uuid, c public.challenges) returns integer
  language sql stable security definer set search_path = ''
  as $$
    select case c.goal
      when 'songs' then (select count(*) from public.performances p where p.user_id = p_user
                         and (p.created_at at time zone 'UTC')::date between c.starts_on and c.ends_on)
      when 'score_at_least' then (select count(*) from public.performances p where p.user_id = p_user and p.score >= c.threshold
                         and (p.created_at at time zone 'UTC')::date between c.starts_on and c.ends_on)
      when 'pitch_at_least' then (select count(*) from public.performances p where p.user_id = p_user and p.pitch_score * 100 >= c.threshold
                         and (p.created_at at time zone 'UTC')::date between c.starts_on and c.ends_on)
      when 'grade_a_songs' then (select count(distinct p.track_id) from public.performances p where p.user_id = p_user and p.grade in ('A', 'S')
                         and (p.created_at at time zone 'UTC')::date between c.starts_on and c.ends_on)
      when 'new_songs' then (select count(distinct p.track_id) from public.performances p where p.user_id = p_user
                         and (p.created_at at time zone 'UTC')::date between c.starts_on and c.ends_on
                         and not exists (select 1 from public.performances q where q.user_id = p_user and q.track_id = p.track_id
                                          and (q.created_at at time zone 'UTC')::date < c.starts_on))
    end::integer
  $$;

-- ---------------------------------------------------------------- award on every performance
create or replace function private.award_progression() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  declare
    c public.challenges;
    s record;
  begin
    if (select is_guest from public.profiles where id = new.user_id) then return new; end if;   -- party guests: no progression
    perform private.grant_xp(new.user_id, 10 + new.score / 4, 'performance', new.id);
    if not exists (select 1 from public.performances p where p.user_id = new.user_id and p.track_id = new.track_id and p.id <> new.id) then
      perform private.grant_xp(new.user_id, 15, 'new_song', new.id);
    end if;
    perform private.ensure_challenges();
    for c in select * from public.challenges where (now() at time zone 'UTC')::date between starts_on and ends_on loop
      if not exists (select 1 from public.challenge_completions cc where cc.user_id = new.user_id and cc.challenge_id = c.id)
         and private.challenge_progress(new.user_id, c) >= c.target then
        insert into public.challenge_completions (user_id, challenge_id) values (new.user_id, c.id);
        perform private.grant_xp(new.user_id, c.xp_reward, 'challenge:' || c.id, new.id);
        insert into public.user_achievements (user_id, achievement_id, performance_id) values (new.user_id, 'challenge_first', new.id) on conflict do nothing;
      end if;
    end loop;
    s := private.streaks(new.user_id);
    if s.current_streak >= 3 then insert into public.user_achievements (user_id, achievement_id, performance_id) values (new.user_id, 'streak_3', new.id) on conflict do nothing; end if;
    if s.current_streak >= 7 then insert into public.user_achievements (user_id, achievement_id, performance_id) values (new.user_id, 'streak_7', new.id) on conflict do nothing; end if;
    return new;
  end
  $$;
create trigger performances_award_progression after insert on public.performances
  for each row execute function private.award_progression();

insert into public.achievements (id, title, description, icon, tier, sort_order) values
  ('streak_3', 'On a Roll', 'Sing on 3 days in a row.', 'flame', 'bronze', 50),
  ('streak_7', 'Week Warrior', 'Sing every day for a week.', 'flame', 'gold', 51),
  ('level_5', 'Rising Star', 'Reach level 5.', 'star', 'silver', 52),
  ('level_10', 'Headline Act', 'Reach level 10.', 'crown', 'gold', 53),
  ('challenge_first', 'Challenger', 'Complete your first daily or weekly challenge.', 'thumbsup', 'bronze', 54)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- read APIs
create or replace function public.my_progress()
returns table (xp integer, level integer, level_floor integer, next_level_xp integer, current_streak integer, best_streak integer, songs_today bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare v_xp integer; v_level integer; s record;
begin
  if (select auth.uid()) is null then return; end if;
  select p.xp into v_xp from public.profiles p where p.id = (select auth.uid());
  v_level := public.level_for_xp(coalesce(v_xp, 0));
  s := private.streaks((select auth.uid()));
  return query select coalesce(v_xp, 0), v_level, 100 * (v_level - 1) * (v_level - 1), 100 * v_level * v_level,
    s.current_streak, s.best_streak,
    (select count(*) from public.performances p where p.user_id = (select auth.uid()) and (p.created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date);
end
$$;

create or replace function public.my_challenges()
returns table (id text, kind text, title text, target integer, progress integer, xp_reward integer, ends_on date, completed boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then return; end if;
  perform private.ensure_challenges();
  return query
  select c.id, c.kind, c.title, c.target, least(private.challenge_progress((select auth.uid()), c), c.target), c.xp_reward, c.ends_on,
         exists (select 1 from public.challenge_completions cc where cc.user_id = (select auth.uid()) and cc.challenge_id = c.id)
  from public.challenges c
  where (now() at time zone 'UTC')::date between c.starts_on and c.ends_on
  order by c.kind, c.id;
end
$$;

grant execute on function public.my_progress, public.my_challenges, public.level_for_xp to authenticated;
revoke execute on function public.my_progress, public.my_challenges from anon;
