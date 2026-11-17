-- SoundCheck M1 database tests (pgTAP). Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- ------------------------------------------------------------------ helpers
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ------------------------------------------------------------------ fixtures (as postgres)
-- Start from an empty catalog even if the local stack is seeded with real songs (rolled back at the end).
truncate public.tracks, public.albums, public.artists, public.artwork, public.audio_assets cascade;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, is_anonymous) values
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@test.dev', '{"display_name":"Alice"}', false),
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@test.dev', '{}', false),
  ('c0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol@test.dev', '{}', false),
  ('d0000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{}', true);

insert into public.artists (id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'Aurora Vale'),
  ('a1000000-0000-0000-0000-000000000002', 'Zoë Marlowe');
insert into public.albums (id, title, artist_credit, release_year) values
  ('ab000000-0000-0000-0000-000000000001', 'First Light', 'Aurora Vale', 2015);
insert into public.tracks (id, title, artist_credit, album_id, duration_ms, popularity) values
  ('7a000000-0000-0000-0000-000000000001', 'Midnight Signal', 'Aurora Vale', 'ab000000-0000-0000-0000-000000000001', 200000, 12),
  ('7a000000-0000-0000-0000-000000000002', 'Midnight Signal', 'The Night Owls', null, 210000, 1),
  ('7a000000-0000-0000-0000-000000000003', 'Paper Lanterns', 'Zoë Marlowe', null, 185000, 5),
  ('7a000000-0000-0000-0000-000000000004', 'Bohemian Rhapsody', 'Queen', null, 354000, 1500),
  ('7a000000-0000-0000-0000-000000000005', 'Bohemian Rapsody', 'Some Garage Band', null, 300000, 1),
  ('7a000000-0000-0000-0000-000000000006', 'The Night Chicago Died', 'Paper Lace', null, 210000, 700);
insert into public.artwork (entity_type, entity_id, provider, source_url, is_primary) values
  ('album', 'ab000000-0000-0000-0000-000000000001', 'coverartarchive', 'https://coverartarchive.org/release-group/x/front-500', true);

-- ------------------------------------------------------------------ schema-wide guarantees
select is(
  (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity),
  0, 'every public table has RLS enabled');
select is((select count(*)::int from storage.buckets where id in ('audio', 'artwork', 'avatars')), 3, 'storage buckets exist');
select ok((select public from storage.buckets where id = 'audio') = false, 'audio bucket is private');

-- ------------------------------------------------------------------ profiles trigger
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a'), 'Alice', 'profile created from metadata');
select is((select display_name from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b'), 'bob', 'profile name falls back to email local part');
select ok((select is_guest from public.profiles where id = 'd0000000-0000-0000-0000-00000000000d'), 'anonymous user is a guest');
select is((select count(*)::int from public.user_preferences where user_id::text like '_0000000-0000-0000-0000-00000000000_'), 4, 'preferences row per user');

-- ------------------------------------------------------------------ catalog: public read, no client writes
select pg_temp.as_anon();
select is((select count(*)::int from public.tracks), 6, 'anon can read tracks');
select throws_ok($$ insert into public.tracks (title, artist_credit) values ('x', 'y') $$, '42501', null, 'anon cannot insert tracks');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select throws_ok($$ insert into public.artists (name) values ('Fake') $$, '42501', null, 'users cannot insert artists');
select is((select count(*)::int from public.profiles where id::text like '_0000000-0000-0000-0000-00000000000_'), 4, 'profiles are publicly readable');

-- ------------------------------------------------------------------ search
select is((select artist_credit from public.search_tracks('midnight sig') limit 1), 'Aurora Vale', 'prefix search ranks the more popular match first');
select is((select count(*)::int from public.search_tracks('midnight sig')), 2, 'prefix search finds both versions');
select is((select title from public.search_tracks('zoe lantern') limit 1), 'Paper Lanterns', 'search is accent-insensitive');
select is((select title from public.search_tracks('midnite signall') limit 1), 'Midnight Signal', 'typo fallback finds the song');
select is((select artwork_url from public.search_tracks('midnight') limit 1), 'https://coverartarchive.org/release-group/x/front-500', 'search returns album artwork');
select is((select count(*)::int from public.search_tracks('   ')), 0, 'empty query returns nothing');
select is((select artist_credit from public.search_tracks('bohemian rapsody') limit 1), 'Queen', 'famous near-match beats an obscure exact typo-title');
select is((select artist_credit from public.search_tracks('bohemian rhapsody') limit 1), 'Queen', 'exact query still ranks the original first');
select is((select title from public.search_tracks('paper lantern') limit 1), 'Paper Lanterns', 'all-words match beats a popular partial match');

-- ------------------------------------------------------------------ playlists & favorites
select lives_ok($$ insert into public.playlists (id, title) values ('91000000-0000-0000-0000-000000000001', 'Alice Private') $$, 'alice creates a playlist');
select lives_ok($$ insert into public.playlist_tracks (playlist_id, track_id, position) values ('91000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 1) $$, 'alice adds a track');
select lives_ok($$ insert into public.favorites (track_id) values ('7a000000-0000-0000-0000-000000000003') $$, 'alice favorites a track');
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.playlists), 0, 'bob cannot see alice private playlist');
select is((select count(*)::int from public.favorites), 0, 'bob cannot see alice favorites');
select throws_ok($$ insert into public.playlist_tracks (playlist_id, track_id, position) values ('91000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000002', 2) $$, '42501', null, 'bob cannot add to alice playlist');
select throws_ok($$ insert into public.listening_history (user_id, track_id, platform) values ('a0000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-000000000001', 'web') $$, '42501', null, 'bob cannot write alice history');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
update public.playlists set is_public = true where id = '91000000-0000-0000-0000-000000000001';
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.playlist_tracks), 1, 'bob sees tracks once the playlist is public');
select is((select count(*)::int from (select 1 from public.playlists where title = 'Alice Private') x), 1, 'public playlist is readable');

-- ------------------------------------------------------------------ audio assets + processing
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select lives_ok($$ insert into public.audio_assets (id, track_id, owner_id, kind, provider, storage_path)
                   values ('aa000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
                           'original', 'upload', 'a0000000-0000-0000-0000-00000000000a/uploads/song.flac') $$, 'alice registers her upload');
select throws_ok($$ insert into public.audio_assets (track_id, owner_id, kind, provider, storage_path)
                    values ('7a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'original', 'upload',
                            'b0000000-0000-0000-0000-00000000000b/stolen.flac') $$, '42501', null, 'upload path must be inside own folder');
select throws_ok($$ insert into public.audio_assets (track_id, owner_id, kind, provider, storage_path, source_asset_id)
                    values ('7a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'instrumental', 'pipeline',
                            'a0000000-0000-0000-0000-00000000000a/x.m4a', 'aa000000-0000-0000-0000-000000000001') $$, '42501', null, 'users cannot register stems');
select is((select status from public.request_processing('aa000000-0000-0000-0000-000000000001')), 'queued', 'processing request is queued');
select is((select status from public.request_processing('aa000000-0000-0000-0000-000000000001')), 'queued', 'repeat request is idempotent');
select is((select count(*)::int from public.processing_jobs), 1, 'only one job exists');
select throws_ok($$ select public.worker_claim_jobs('w1') $$, '42501', null, 'users cannot call worker functions');
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.audio_assets), 0, 'bob cannot see alice audio');
select throws_ok($$ select * from public.request_processing('aa000000-0000-0000-0000-000000000001') $$, 'P0002', null, 'bob cannot process alice audio');
select pg_temp.as_admin();
select is((select count(*)::int from pgmq.q_audio_processing), 1, 'one message on the processing queue');
select is((select job ->> 'asset_id' from public.worker_claim_jobs('test-worker')), 'aa000000-0000-0000-0000-000000000001', 'worker claims the job');
select is((select status from public.processing_jobs), 'running', 'claimed job is running');

-- ------------------------------------------------------------------ karaoke sessions & pairing
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
create temp table s as select * from public.create_session('tvos', 'Living Room');
grant select on s to authenticated;
select matches((select pairing_code from s), '^[A-HJ-NP-Z2-9]{6}$', 'pairing code has 6 unambiguous characters');
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.karaoke_sessions), 0, 'non-member cannot see the session');
select lives_ok($$ select public.join_session((select pairing_code from s), 'Bob', 'ios') $$, 'bob joins with the code');
select is((select count(*)::int from public.session_members), 2, 'bob sees host + himself');
select ok(private.is_session_member((select session_id from s)), 'bob is authorised for the realtime channel');
select throws_ok($$ select public.join_session('ZZZZZZ', 'Bob', 'ios') $$, 'P0002', null, 'invalid code is rejected');
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
select lives_ok($$ select public.join_session(lower((select pairing_code from s)), 'Guest', 'android') $$, 'anonymous guest joins (code is case-insensitive)');
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
select ok(not private.is_session_member((select session_id from s)), 'carol is not authorised for the channel');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
update public.session_members set kicked = true where display_name = 'Guest';
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.join_session((select pairing_code from s), 'Guest', 'android') $$, '42501', null, 'kicked guest cannot rejoin');

-- ------------------------------------------------------------------ performances, achievements, leaderboards
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select throws_ok($$ insert into public.performances (user_id, track_id, score, pitch_score, timing_score, rhythm_score, stability_score, grade, scoring_version)
                    values ('b0000000-0000-0000-0000-00000000000b', '7a000000-0000-0000-0000-000000000001', 100, 1, 1, 1, 1, 'S', 'v1') $$,
                 '42501', null, 'clients cannot forge scores');
select pg_temp.as_admin();
insert into public.performances (session_id, user_id, track_id, key_shift, score, pitch_score, timing_score, rhythm_score, stability_score, grade, scoring_version)
values ((select session_id from s), 'b0000000-0000-0000-0000-00000000000b', '7a000000-0000-0000-0000-000000000001', 2, 91, 0.96, 0.9, 0.88, 0.85, 'A', 'v1'),
       (null, 'a0000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-000000000001', 0, 78, 0.8, 0.8, 0.7, 0.75, 'B', 'v1'),
       (null, 'a0000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-000000000001', 0, 84, 0.85, 0.8, 0.8, 0.8, 'B', 'v1'),
       (null, 'd0000000-0000-0000-0000-00000000000d', '7a000000-0000-0000-0000-000000000001', 0, 99, 1, 1, 1, 1, 'S', 'v1');
select set_eq($$ select achievement_id from public.user_achievements where user_id = 'b0000000-0000-0000-0000-00000000000b' $$,
              array['first_song', 'score_80', 'score_90', 'perfect_pitch', 'key_changer'], 'achievements awarded from the performance');
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
select results_eq($$ select display_name, score from public.track_leaderboard('7a000000-0000-0000-0000-000000000001') $$,
                  $$ values ('bob'::text, 91::smallint), ('Alice'::text, 84::smallint) $$,
                  'global leaderboard: best score per user, guests excluded');
select is((select count(*)::int from public.track_leaderboard('7a000000-0000-0000-0000-000000000001', 'friends')), 0, 'carol has no friends on the board yet');
select lives_ok($$ insert into public.friendships (friend_id) values ('a0000000-0000-0000-0000-00000000000a') $$, 'carol sends alice a request');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select lives_ok($$ update public.friendships set status = 'accepted', accepted_at = now() where user_id = 'c0000000-0000-0000-0000-00000000000c' $$, 'alice accepts');
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
select is((select display_name from public.track_leaderboard('7a000000-0000-0000-0000-000000000001', 'friends')), 'Alice', 'friends leaderboard shows alice');

-- ------------------------------------------------------------------ privilege escalation guards (migration 7)
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
select throws_ok($$ update public.profiles set is_guest = false where id = 'd0000000-0000-0000-0000-00000000000d' $$, '42501', null, 'guest cannot clear is_guest');
select lives_ok($$ update public.profiles set display_name = 'Guest Star' where id = 'd0000000-0000-0000-0000-00000000000d' $$, 'guest can rename themselves');
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select throws_ok($$ update public.session_members set role = 'host' where user_id = 'b0000000-0000-0000-0000-00000000000b' $$, '42501', null, 'member cannot promote themselves to host');
select lives_ok($$ update public.session_members set mic_volume = 1.5 where user_id = 'b0000000-0000-0000-0000-00000000000b' $$, 'member can set own mic volume');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select throws_ok($$ update public.friendships set user_id = 'b0000000-0000-0000-0000-00000000000b' where friend_id = 'a0000000-0000-0000-0000-00000000000a' $$, '42501', null, 'friend cannot rewrite the requester');
select throws_ok($$ update public.karaoke_sessions set host_id = 'b0000000-0000-0000-0000-00000000000b' $$, '42501', null, 'host cannot hand the session to someone else directly');

select * from finish();
rollback;
