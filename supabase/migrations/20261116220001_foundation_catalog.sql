-- SoundCheck M1 · 1/6 · Extensions, private helpers, music catalog.
-- Catalog rows are public-readable; only the service role (imports, Edge
-- Functions, GPU worker) writes them.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Internal helpers live outside the API-exposed `public` schema.
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- unaccent() is STABLE; generated columns and indexes need IMMUTABLE.
create or replace function private.unaccent_imm(text) returns text
  language sql immutable parallel safe strict
  set search_path = ''
  as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- Normalisation for grouping/matching: lowercase, no accents, unified quotes, single spaces.
create or replace function private.norm(text) returns text
  language sql immutable parallel safe strict
  set search_path = ''
  as $$
    select btrim(regexp_replace(lower(private.unaccent_imm(translate($1, '’‘“”´`', $q$''""''$q$))), '\s+', ' ', 'g'))
  $$;

create or replace function private.set_updated_at() returns trigger
  language plpgsql set search_path = ''
  as $$ begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- artists
create table public.artists (
  id             uuid primary key default gen_random_uuid(),
  mbid           uuid unique,
  name           text not null check (length(name) between 1 and 500),
  sort_name      text,
  disambiguation text,
  country        text,
  popularity     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  search         tsvector generated always as (to_tsvector('simple', private.unaccent_imm(name))) stored
);
comment on table public.artists is 'Music artists (MusicBrainz-sourced). Public read; service-role write.';
create index artists_search_idx on public.artists using gin (search);
create index artists_name_trgm_idx on public.artists using gin (private.norm(name) extensions.gin_trgm_ops);
create trigger artists_updated_at before update on public.artists for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------- albums (MusicBrainz release groups)
create table public.albums (
  id            uuid primary key default gen_random_uuid(),
  mbid          uuid unique,
  title         text not null check (length(title) between 1 and 500),
  artist_credit text not null,
  primary_type  text not null default 'album' check (primary_type in ('album', 'single', 'ep', 'other')),
  release_year  smallint check (release_year between 1800 and 2200),
  release_date  date,
  popularity    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  search        tsvector generated always as (
    setweight(to_tsvector('simple', private.unaccent_imm(title)), 'A') ||
    setweight(to_tsvector('simple', private.unaccent_imm(artist_credit)), 'B')
  ) stored
);
create index albums_search_idx on public.albums using gin (search);
create trigger albums_updated_at before update on public.albums for each row execute function private.set_updated_at();

create table public.album_artists (
  album_id    uuid not null references public.albums (id) on delete cascade,
  position    smallint not null check (position >= 0),
  artist_id   uuid not null references public.artists (id) on delete cascade,
  join_phrase text not null default '',
  primary key (album_id, position)
);
create index album_artists_artist_idx on public.album_artists (artist_id);

-- ---------------------------------------------------------------- tracks (one row per song)
create table public.tracks (
  id            uuid primary key default gen_random_uuid(),
  mbid          uuid unique,                       -- representative MusicBrainz recording
  title         text not null check (length(title) between 1 and 500),
  artist_credit text not null,                     -- display string, e.g. "Queen & David Bowie"
  album_id      uuid references public.albums (id) on delete set null,
  duration_ms   integer check (duration_ms > 0),
  release_year  smallint check (release_year between 1800 and 2200),
  isrcs         text[] not null default '{}',
  popularity    integer not null default 0,        -- eligible-release count, later blended with plays
  norm_title    text generated always as (private.norm(title)) stored,
  norm_artist   text generated always as (private.norm(artist_credit)) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  search        tsvector generated always as (
    setweight(to_tsvector('simple', private.unaccent_imm(title)), 'A') ||
    setweight(to_tsvector('simple', private.unaccent_imm(artist_credit)), 'B')
  ) stored
);
comment on table public.tracks is 'Songs. Exists independently of any playable audio (see audio_assets).';
create index tracks_search_idx on public.tracks using gin (search);
create index tracks_trgm_idx on public.tracks using gin ((norm_title || ' ' || norm_artist) extensions.gin_trgm_ops);
create index tracks_norm_idx on public.tracks (norm_title, norm_artist);
create index tracks_album_idx on public.tracks (album_id);
create index tracks_popularity_idx on public.tracks (popularity desc);
create index tracks_isrcs_idx on public.tracks using gin (isrcs);
create trigger tracks_updated_at before update on public.tracks for each row execute function private.set_updated_at();

create table public.track_artists (
  track_id    uuid not null references public.tracks (id) on delete cascade,
  position    smallint not null check (position >= 0),
  artist_id   uuid not null references public.artists (id) on delete cascade,
  join_phrase text not null default '',
  primary key (track_id, position)
);
create index track_artists_artist_idx on public.track_artists (artist_id);

-- Every MusicBrainz recording that maps to a track (remasters, reissues): exact matching for uploads.
create table public.track_recordings (
  recording_mbid uuid primary key,
  track_id       uuid not null references public.tracks (id) on delete cascade
);
create index track_recordings_track_idx on public.track_recordings (track_id);

-- ---------------------------------------------------------------- artwork
create table public.artwork (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('album', 'artist', 'track')),
  entity_id    uuid not null,
  provider     text not null check (provider in ('coverartarchive', 'itunes', 'spotify_oembed', 'cov_manual', 'upload', 'deezer')),
  source_url   text not null,
  storage_path text,                               -- cached copy in the public `artwork` bucket
  width        integer check (width > 0),
  height       integer check (height > 0),
  phash        bigint,                             -- perceptual hash for duplicate detection
  is_primary   boolean not null default false,
  status       text not null default 'ok' check (status in ('ok', 'broken', 'rejected')),
  checked_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (entity_type, entity_id, provider, source_url)
);
create unique index artwork_one_primary_idx on public.artwork (entity_type, entity_id) where is_primary;
create index artwork_entity_idx on public.artwork (entity_type, entity_id);

-- ---------------------------------------------------------------- lyrics
create table public.lyrics (
  id           uuid primary key default gen_random_uuid(),
  track_id     uuid not null references public.tracks (id) on delete cascade,
  provider     text not null check (provider in ('lrclib', 'musixmatch', 'aligned', 'manual')),
  provider_ref text,
  language     text,
  granularity  text not null check (granularity in ('plain', 'line', 'word')),
  -- {"lines":[{"start":s,"end":s,"text":"...","words":[{"start":s,"end":s,"text":"..."}]}]}
  content      jsonb not null check (jsonb_typeof(content -> 'lines') = 'array'),
  is_primary   boolean not null default false,
  fetched_at   timestamptz not null default now(),
  unique (track_id, provider)
);
create unique index lyrics_one_primary_idx on public.lyrics (track_id) where is_primary;

-- ---------------------------------------------------------------- RLS: public read, service write
alter table public.artists enable row level security;
alter table public.albums enable row level security;
alter table public.album_artists enable row level security;
alter table public.tracks enable row level security;
alter table public.track_artists enable row level security;
alter table public.track_recordings enable row level security;
alter table public.artwork enable row level security;
alter table public.lyrics enable row level security;

create policy "catalog is public" on public.artists for select to anon, authenticated using (true);
create policy "catalog is public" on public.albums for select to anon, authenticated using (true);
create policy "catalog is public" on public.album_artists for select to anon, authenticated using (true);
create policy "catalog is public" on public.tracks for select to anon, authenticated using (true);
create policy "catalog is public" on public.track_artists for select to anon, authenticated using (true);
create policy "catalog is public" on public.track_recordings for select to anon, authenticated using (true);
create policy "catalog is public" on public.artwork for select to anon, authenticated using (status = 'ok');
create policy "catalog is public" on public.lyrics for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- search
-- Prefix full-text search (search-as-you-type), accent-insensitive, typo fallback via trigrams.
create or replace function public.search_tracks(q text, lim integer default 30, off integer default 0)
returns table (
  id uuid, title text, artist_credit text, album_id uuid, album_title text,
  duration_ms integer, release_year smallint, popularity integer, artwork_url text, rank real
)
language plpgsql
set search_path = ''
as $$
declare
  words text[];
  tsq   tsquery;
  n     integer;
begin
  lim := least(greatest(coalesce(lim, 30), 1), 100);
  off := greatest(coalesce(off, 0), 0);
  words := regexp_split_to_array(lower(private.unaccent_imm(coalesce(q, ''))), '[^[:alnum:]]+');
  words := array_remove(words, '');
  if coalesce(array_length(words, 1), 0) = 0 then
    return;
  end if;
  n := array_length(words, 1);
  -- last word is a prefix (user is still typing) when it has 2+ chars
  if length(words[n]) >= 2 then
    words[n] := words[n] || ':*';
  end if;
  tsq := to_tsquery('simple', array_to_string(words, ' & '));

  return query
    select t.id, t.title, t.artist_credit, t.album_id, a.title, t.duration_ms, t.release_year, t.popularity,
           (select coalesce(aw.storage_path, aw.source_url) from public.artwork aw
             where aw.entity_type = 'album' and aw.entity_id = t.album_id and aw.is_primary and aw.status = 'ok' limit 1),
           (ts_rank_cd(t.search, tsq) * (1 + ln(1 + t.popularity)))::real as r
    from public.tracks t
    left join public.albums a on a.id = t.album_id
    where t.search @@ tsq
    order by r desc, t.id
    limit lim offset off;

  if not found and off = 0 then
    -- default 0.6 misses ordinary typos ("midnite signall" ~ 0.55)
    perform set_config('pg_trgm.word_similarity_threshold', '0.45', true);
    return query
      select t.id, t.title, t.artist_credit, t.album_id, a.title, t.duration_ms, t.release_year, t.popularity,
             (select coalesce(aw.storage_path, aw.source_url) from public.artwork aw
               where aw.entity_type = 'album' and aw.entity_id = t.album_id and aw.is_primary and aw.status = 'ok' limit 1),
             extensions.word_similarity(private.norm(q), t.norm_title || ' ' || t.norm_artist)::real as r
      from public.tracks t
      left join public.albums a on a.id = t.album_id
      where private.norm(q) operator(extensions.<%) (t.norm_title || ' ' || t.norm_artist)  -- uses tracks_trgm_idx
      order by r desc, t.popularity desc, t.id
      limit lim;
  end if;
end
$$;
comment on function public.search_tracks is 'Catalog search: prefix full-text with popularity boost, trigram typo fallback.';
grant execute on function public.search_tracks to anon, authenticated;
