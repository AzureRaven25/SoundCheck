-- SoundCheck M1 · 2/6 · Profiles, preferences, playlists, favorites, history, friendships.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  username               text check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name           text not null check (length(display_name) between 1 and 40),
  avatar_url             text,
  bio                    text check (length(bio) <= 300),
  vocal_low              smallint check (vocal_low between 24 and 108),   -- MIDI note, from the range test
  vocal_high             smallint check (vocal_high between 24 and 108),
  is_guest               boolean not null default false,                  -- anonymous (QR-joined) users
  show_on_leaderboards   boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (vocal_low is null or vocal_high is null or vocal_low <= vocal_high)
);
create unique index profiles_username_idx on public.profiles (username) where username is not null;
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();

-- Every auth user (including anonymous guests) gets a profile.
create or replace function private.handle_new_user() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    insert into public.profiles (id, display_name, avatar_url, is_guest)
    values (
      new.id,
      left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
                    nullif(new.raw_user_meta_data ->> 'full_name', ''),
                    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                    'Singer ' || upper(left(new.id::text, 4))), 40),
      new.raw_user_meta_data ->> 'avatar_url',
      coalesce(new.is_anonymous, false)
    );
    insert into public.user_preferences (user_id) values (new.id);
    return new;
  end
  $$;

-- Keep is_guest in sync when an anonymous user upgrades to a full account.
create or replace function private.handle_user_updated() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false) then
      update public.profiles set is_guest = false where id = new.id;
    end if;
    return new;
  end
  $$;

alter table public.profiles enable row level security;
create policy "profiles are public" on public.profiles for select to anon, authenticated using (true);
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------- preferences
create table public.user_preferences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- e.g. {"theme":"dark","default_key_shift":0,"guide_vocal":0,"lyrics_size":"large","autoplay":true}
  prefs      jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  updated_at timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences for each row execute function private.set_updated_at();
alter table public.user_preferences enable row level security;
create policy "own preferences" on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
create trigger on_auth_user_updated after update of is_anonymous on auth.users for each row execute function private.handle_user_updated();

-- ---------------------------------------------------------------- playlists
create table public.playlists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (length(title) between 1 and 100),
  description text check (length(description) <= 1000),
  is_public   boolean not null default false,
  cover_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index playlists_owner_idx on public.playlists (owner_id);
create trigger playlists_updated_at before update on public.playlists for each row execute function private.set_updated_at();

create table public.playlist_tracks (
  id          bigint generated always as identity primary key,
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  track_id    uuid not null references public.tracks (id) on delete cascade,
  position    double precision not null,           -- fractional ordering: insert between without renumbering
  added_at    timestamptz not null default now(),
  unique (playlist_id, position)
);
create index playlist_tracks_playlist_idx on public.playlist_tracks (playlist_id, position);

create or replace function private.owns_playlist(p uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.playlists where id = p and owner_id = (select auth.uid())) $$;
create or replace function private.can_read_playlist(p uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.playlists where id = p and (is_public or owner_id = (select auth.uid()))) $$;

alter table public.playlists enable row level security;
create policy "read public or own playlists" on public.playlists for select to anon, authenticated
  using (is_public or owner_id = (select auth.uid()));
create policy "create own playlists" on public.playlists for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "update own playlists" on public.playlists for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "delete own playlists" on public.playlists for delete to authenticated
  using (owner_id = (select auth.uid()));

alter table public.playlist_tracks enable row level security;
create policy "read tracks of readable playlists" on public.playlist_tracks for select to anon, authenticated
  using (private.can_read_playlist(playlist_id));
create policy "edit tracks of own playlists" on public.playlist_tracks for all to authenticated
  using (private.owns_playlist(playlist_id)) with check (private.owns_playlist(playlist_id));

-- ---------------------------------------------------------------- favorites
create table public.favorites (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id   uuid not null references public.tracks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
create index favorites_user_recent_idx on public.favorites (user_id, created_at desc);
alter table public.favorites enable row level security;
create policy "own favorites" on public.favorites for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- history
create table public.listening_history (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id   uuid not null references public.tracks (id) on delete cascade,
  played_at  timestamptz not null default now(),
  ms_played  integer not null default 0 check (ms_played >= 0),
  mode       text not null default 'listen' check (mode in ('listen', 'karaoke', 'preview')),
  platform   text not null check (platform in ('web', 'tvos', 'firetv', 'ios', 'android'))
);
create index listening_history_user_idx on public.listening_history (user_id, played_at desc);
alter table public.listening_history enable row level security;
create policy "read own history" on public.listening_history for select to authenticated
  using (user_id = (select auth.uid()));
create policy "append own history" on public.listening_history for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "delete own history" on public.listening_history for delete to authenticated
  using (user_id = (select auth.uid()));

create table public.search_history (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  query      text not null check (length(query) between 1 and 200),
  created_at timestamptz not null default now()
);
create index search_history_user_idx on public.search_history (user_id, created_at desc);
alter table public.search_history enable row level security;
create policy "own search history" on public.search_history for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- friendships
create table public.friendships (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,  -- requester
  friend_id  uuid not null references auth.users (id) on delete cascade,                    -- addressee
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index friendships_friend_idx on public.friendships (friend_id);
-- one relationship per pair regardless of direction
create unique index friendships_pair_idx on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));

create or replace function private.are_friends(a uuid, b uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from public.friendships
      where status = 'accepted' and ((user_id = a and friend_id = b) or (user_id = b and friend_id = a))
    )
  $$;

alter table public.friendships enable row level security;
create policy "see own friendships" on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_id, friend_id));
create policy "send friend requests" on public.friendships for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
create policy "accept requests sent to me" on public.friendships for update to authenticated
  using (friend_id = (select auth.uid())) with check (friend_id = (select auth.uid()) and status = 'accepted');
create policy "remove friendships" on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_id, friend_id));
