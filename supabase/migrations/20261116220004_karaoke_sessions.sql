-- SoundCheck M1 · 4/6 · SoundCheck Stage / Party: sessions, members, queue, performances.

create table public.karaoke_sessions (
  id               uuid primary key default gen_random_uuid(),
  host_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pairing_code     text not null check (pairing_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  status           text not null default 'lobby' check (status in ('lobby', 'active', 'ended')),
  host_platform    text not null check (host_platform in ('web', 'tvos', 'firetv', 'ios', 'android')),
  current_track_id uuid references public.tracks (id) on delete set null,
  settings         jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  max_members      smallint not null default 12 check (max_members between 1 and 32),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '12 hours',
  ended_at         timestamptz
);
-- A code is unique among sessions that are still joinable.
create unique index karaoke_sessions_code_idx on public.karaoke_sessions (pairing_code) where status <> 'ended';
create index karaoke_sessions_host_idx on public.karaoke_sessions (host_id, created_at desc);

create table public.session_members (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.karaoke_sessions (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,   -- anonymous guests included
  display_name   text not null check (length(display_name) between 1 and 40),
  role           text not null default 'singer' check (role in ('host', 'singer', 'viewer')),
  device_platform text check (device_platform in ('web', 'tvos', 'firetv', 'ios', 'android')),
  color          text not null default '#FF3D9A',
  mic_volume     real not null default 1 check (mic_volume between 0 and 2),
  joined_at      timestamptz not null default now(),
  left_at        timestamptz,
  kicked         boolean not null default false,
  unique (session_id, user_id)
);
create index session_members_user_idx on public.session_members (user_id);

create or replace function private.is_session_member(s uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from public.session_members
      where session_id = s and user_id = (select auth.uid()) and not kicked and left_at is null
    )
  $$;
create or replace function private.is_session_host(s uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.karaoke_sessions where id = s and host_id = (select auth.uid())) $$;

alter table public.karaoke_sessions enable row level security;
create policy "members see their sessions" on public.karaoke_sessions for select to authenticated
  using (host_id = (select auth.uid()) or private.is_session_member(id));
create policy "host updates session" on public.karaoke_sessions for update to authenticated
  using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));

alter table public.session_members enable row level security;
create policy "members see each other" on public.session_members for select to authenticated
  using (private.is_session_member(session_id) or private.is_session_host(session_id));
create policy "update own membership" on public.session_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and not kicked);
create policy "host manages members" on public.session_members for update to authenticated
  using (private.is_session_host(session_id)) with check (private.is_session_host(session_id));

-- ---------------------------------------------------------------- pairing RPCs
create or replace function private.new_pairing_code() returns text
  language plpgsql volatile set search_path = ''
  as $$
  declare
    alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O/1/I
    code text;
  begin
    loop
      code := '';
      for i in 1..6 loop
        code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from public.karaoke_sessions where pairing_code = code and status <> 'ended');
    end loop;
    return code;
  end
  $$;

create or replace function public.create_session(p_platform text, p_display_name text default 'Host')
returns table (session_id uuid, pairing_code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v public.karaoke_sessions;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  -- expire this host's stale sessions so codes free up
  -- (columns qualified: the OUT parameters share their names)
  update public.karaoke_sessions ks set status = 'ended', ended_at = now()
   where ks.host_id = (select auth.uid()) and ks.status <> 'ended' and ks.expires_at < now();

  insert into public.karaoke_sessions (host_id, pairing_code, host_platform)
  values ((select auth.uid()), private.new_pairing_code(), p_platform)
  returning * into v;
  insert into public.session_members (session_id, user_id, display_name, role, device_platform, color)
  values (v.id, (select auth.uid()), left(coalesce(nullif(btrim(p_display_name), ''), 'Host'), 40), 'host', p_platform, '#FFFFFF');
  return query select v.id, v.pairing_code, v.expires_at;
end
$$;

create or replace function public.join_session(p_code text, p_display_name text, p_platform text)
returns table (session_id uuid, member_id uuid, color text, host_platform text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.karaoke_sessions;
  v_member  public.session_members;
  v_count   integer;
  palette constant text[] := array['#FF3D9A', '#38E1FF', '#FFC94D', '#3DDC97', '#8B5CFF', '#FF8A3D', '#FF5E5E', '#5E9BFF'];
begin
  if (select auth.uid()) is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  select * into v_session from public.karaoke_sessions s
   where s.pairing_code = upper(btrim(p_code)) and s.status <> 'ended' and s.expires_at > now();
  if not found then
    raise exception 'invalid or expired code' using errcode = 'P0002';
  end if;

  select * into v_member from public.session_members m where m.session_id = v_session.id and m.user_id = (select auth.uid());
  if found then
    if v_member.kicked then
      raise exception 'removed from this session' using errcode = '42501';
    end if;
    update public.session_members m
       set left_at = null, display_name = left(coalesce(nullif(btrim(p_display_name), ''), m.display_name), 40),
           device_platform = p_platform
     where m.id = v_member.id returning * into v_member;
  else
    select count(*) into v_count from public.session_members m where m.session_id = v_session.id and not m.kicked;
    if v_count >= v_session.max_members then
      raise exception 'session is full' using errcode = '53400';
    end if;
    insert into public.session_members (session_id, user_id, display_name, role, device_platform, color)
    values (v_session.id, (select auth.uid()), left(coalesce(nullif(btrim(p_display_name), ''), 'Singer'), 40), 'singer',
            p_platform, palette[1 + (v_count - 1 + array_length(palette, 1)) % array_length(palette, 1)])
    returning * into v_member;
  end if;
  return query select v_session.id, v_member.id, v_member.color, v_session.host_platform;
end
$$;

revoke all on function public.create_session, public.join_session from public, anon;
grant execute on function public.create_session, public.join_session to authenticated;

-- ---------------------------------------------------------------- singer queue
create table public.session_queue (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.karaoke_sessions (id) on delete cascade,
  track_id          uuid not null references public.tracks (id) on delete cascade,
  requested_by      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  singer_member_ids uuid[] not null default '{}',
  key_shift         smallint not null default 0 check (key_shift between -12 and 12),
  position          double precision not null,
  status            text not null default 'queued' check (status in ('queued', 'playing', 'done', 'skipped')),
  created_at        timestamptz not null default now()
);
create index session_queue_session_idx on public.session_queue (session_id, status, position);
alter table public.session_queue enable row level security;
create policy "members see the queue" on public.session_queue for select to authenticated
  using (private.is_session_member(session_id) or private.is_session_host(session_id));
create policy "members add to the queue" on public.session_queue for insert to authenticated
  with check (requested_by = (select auth.uid()) and (private.is_session_member(session_id) or private.is_session_host(session_id)));
create policy "host or requester edits" on public.session_queue for update to authenticated
  using (private.is_session_host(session_id) or requested_by = (select auth.uid()))
  with check (private.is_session_host(session_id) or requested_by = (select auth.uid()));
create policy "host or requester removes" on public.session_queue for delete to authenticated
  using (private.is_session_host(session_id) or requested_by = (select auth.uid()));

-- ---------------------------------------------------------------- performances (SoundCheck Score)
create table public.performances (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid references public.karaoke_sessions (id) on delete set null,
  member_id        uuid references public.session_members (id) on delete set null,
  user_id          uuid not null references auth.users (id) on delete cascade,
  track_id         uuid not null references public.tracks (id) on delete cascade,
  key_shift        smallint not null default 0 check (key_shift between -12 and 12),
  score            smallint not null check (score between 0 and 100),
  pitch_score      real not null check (pitch_score between 0 and 1),
  timing_score     real not null check (timing_score between 0 and 1),
  rhythm_score     real not null check (rhythm_score between 0 and 1),
  stability_score  real not null check (stability_score between 0 and 1),
  grade            text not null check (grade in ('S', 'A', 'B', 'C', 'D')),
  details          jsonb not null default '{}'::jsonb,   -- feedback, latency offset, octave choices, per-phrase scores
  scoring_version  text not null,
  duration_ms      integer check (duration_ms >= 0),
  created_at       timestamptz not null default now()
);
create index performances_user_idx on public.performances (user_id, created_at desc);
create index performances_track_score_idx on public.performances (track_id, score desc);
create index performances_session_idx on public.performances (session_id);

alter table public.performances enable row level security;
-- Scores are written only by the score-performance Edge Function (service role), so they can't be forged.
create policy "see own, session, and leaderboard performances" on public.performances for select to authenticated
  using (
    user_id = (select auth.uid())
    or (session_id is not null and private.is_session_member(session_id))
    or exists (select 1 from public.profiles p where p.id = performances.user_id and p.show_on_leaderboards and not p.is_guest)
  );
