-- Imported listening taste (Spotify summary): owner-only access, catalog matching, recommendations, delete.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); execute 'set local role anon'; end $$;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, is_anonymous) values
  ('f0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'taste1@test.dev', '{"display_name":"Listener"}', false),
  ('f0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'taste2@test.dev', '{"display_name":"Nosy"}', false);
insert into public.artists (id, name, popularity) values
  ('af000000-0000-0000-0000-000000000001', 'Tastë Pilots', 5), ('af000000-0000-0000-0000-000000000002', 'Other Band', 1);
insert into public.tracks (id, title, artist_credit, popularity) values
  ('7f000000-0000-0000-0000-000000000001', 'Paper Lanterns', 'Tastë Pilots', 10),
  ('7f000000-0000-0000-0000-000000000002', 'Glass Harbor', 'Tastë Pilots', 9),
  ('7f000000-0000-0000-0000-000000000003', 'Copper Wire', 'Tastë Pilots & Guest', 8),
  ('7f000000-0000-0000-0000-000000000004', 'Unrelated', 'Other Band', 100);
insert into public.track_artists (track_id, position, artist_id) values
  ('7f000000-0000-0000-0000-000000000001', 0, 'af000000-0000-0000-0000-000000000001'),
  ('7f000000-0000-0000-0000-000000000002', 0, 'af000000-0000-0000-0000-000000000001'),
  ('7f000000-0000-0000-0000-000000000003', 0, 'af000000-0000-0000-0000-000000000001'),
  ('7f000000-0000-0000-0000-000000000004', 0, 'af000000-0000-0000-0000-000000000002');

create temp table summary as select $${
  "source": "spotify", "first_played": "2023-01-01T00:00:00Z", "last_played": "2024-03-01T00:00:00Z",
  "streams": 40, "ms_played": 7200000,
  "tracks": [
    {"title": "Paper Lanterns - Remastered 2011", "artist": "Taste Pilots", "album": "Night", "spotify_uri": "spotify:track:0123456789abcdefABCD",
     "plays": 20, "streams": 25, "ms_played": 4000000, "skip_rate": 0.2, "last_played": "2024-03-01T00:00:00Z"},
    {"title": "Copper Wire (feat. Guest)", "artist": "TASTE PILOTS", "plays": 3, "streams": 3, "ms_played": 600000, "skip_rate": 0, "last_played": "2024-01-01T00:00:00Z"},
    {"title": "Not In Catalog", "artist": "Nobody", "plays": 5, "streams": 5, "ms_played": 900000, "skip_rate": 0, "last_played": "2023-06-01T00:00:00Z", "spotify_uri": "javascript:x"},
    {"title": "", "artist": "Blank"}
  ],
  "artists": [
    {"name": "Taste Pilots", "plays": 23, "streams": 28, "ms_played": 4600000, "skip_rate": 0.18, "last_played": "2024-03-01T00:00:00Z", "track_count": 2},
    {"name": "Nobody", "plays": 5, "streams": 5, "ms_played": 900000, "skip_rate": 0, "last_played": "2023-06-01T00:00:00Z", "track_count": 1}
  ]
}$$::jsonb as s;
grant select on summary to authenticated, anon;

select pg_temp.as_anon();
select throws_ok($$ select public.import_taste((select s from summary)) $$, '42501', null, 'signed-out visitors cannot import');

select pg_temp.as_user('f0000000-0000-0000-0000-0000000000f1');
select lives_ok($$ select public.import_taste((select s from summary)) $$, 'owner imports a summary');
select is((select (track_count, artist_count, streams) from public.taste_imports)::text, '(3,2,40)', 'blank rows are dropped, totals kept');
select is((select matched_tracks from public.taste_imports), 2, 'remaster and feat. titles match the catalog');
select is((select matched_artists from public.taste_imports), 1, 'artists match regardless of case and accents');
select is((select track_id from public.taste_tracks where rank = 1), '7f000000-0000-0000-0000-000000000001'::uuid, 'top song matched');
select is((select track_id from public.taste_tracks where rank = 2), '7f000000-0000-0000-0000-000000000003'::uuid, 'matches a credit that starts with the artist');
select is((select spotify_uri from public.taste_tracks where rank = 3), null, 'bad URIs are dropped');
select throws_ok($$ insert into public.taste_tracks (user_id, rank, title, artist, plays, streams, ms_played, skip_rate, last_played)
  values ('f0000000-0000-0000-0000-0000000000f1', 99, 'x', 'y', 1, 1, 1, 0, now()) $$, '42501', null, 'no direct writes, even to your own rows');
select is((select array_agg(track_id order by track_id) from public.recommended_tracks(12)),
  array['7f000000-0000-0000-0000-000000000002'::uuid],
  'recommends the favorite artist''s other songs, not ones already played 3+ times on Spotify');
select is((select artist_name from public.recommended_tracks(12) limit 1), 'Tastë Pilots', 'says which artist it is because of');
select throws_ok($$ select public.import_taste(jsonb_build_object('tracks', (select jsonb_agg('{}'::jsonb) from generate_series(1, 2001)), 'artists', '[]'::jsonb)) $$,
  '22023', null, 'oversized summaries are refused');
select throws_ok($$ select public.import_taste('{"tracks": 1}'::jsonb) $$, '22023', null, 'malformed summaries are refused');

select pg_temp.as_user('f0000000-0000-0000-0000-0000000000f2');
select is((select count(*)::int from public.taste_imports), 0, 'others cannot see the import');
select is((select count(*)::int from public.taste_tracks), 0, 'others cannot see the tracks');
select is((select count(*)::int from public.taste_artists), 0, 'others cannot see the artists');
delete from public.taste_imports where user_id = 'f0000000-0000-0000-0000-0000000000f1';
select pg_temp.as_user('f0000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.taste_imports), 1, 'others cannot delete it');

select lives_ok($$ select public.import_taste(jsonb_set((select s from summary), '{tracks}', '[]'::jsonb)) $$, 're-import replaces the old summary');
select is((select count(*)::int from public.taste_tracks), 0, 'old tracks are gone after re-import');
delete from public.taste_imports;
select is((select count(*)::int from public.taste_artists), 0, 'deleting the import removes everything');

select * from finish();
rollback;
