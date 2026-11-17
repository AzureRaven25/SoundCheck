-- SoundCheck M8 database tests: party queue, friends, achievements, device sign-in codes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, is_anonymous) values
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'host8@test.dev', '{"display_name":"Hosty McHost"}', false),
  ('e0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pal8@test.dev', '{"display_name":"Pally Pal"}', false),
  ('e0000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'out8@test.dev', '{"display_name":"Outsider"}', false),
  ('e0000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{"display_name":"Pally Guest"}', true);
insert into public.tracks (id, title, artist_credit) values
  ('7e000000-0000-0000-0000-000000000001', 'Queue Song One', 'Test'), ('7e000000-0000-0000-0000-000000000002', 'Queue Song Two', 'Test');

-- ---------------------------------------------------------------- party queue
select pg_temp.as_user('e0000000-0000-0000-0000-0000000000e1');
create temp table s8 as select * from public.create_session('web', 'Hosty');
grant select on s8 to authenticated;
select pg_temp.as_user('e0000000-0000-0000-0000-0000000000e2');
select lives_ok($$ select public.join_session((select pairing_code from s8), 'Pally', 'web') $$, 'pal joins the party');
select lives_ok($$ select public.enqueue_song((select session_id from s8), '7e000000-0000-0000-0000-000000000001') $$, 'member queues a song');
select lives_ok($$ select public.enqueue_song((select session_id from s8), '7e000000-0000-0000-0000-000000000002') $$, 'member queues another');
select is((select count(*)::int from public.session_queue_list((select session_id from s8))), 2, 'members see the queue');
select is((select title from public.session_queue_list((select session_id from s8)) limit 1), 'Queue Song One', 'queue keeps request order');
select is((select requester_name from public.session_queue_list((select session_id from s8)) limit 1), 'Pally', 'queue shows the requester');
select throws_ok($$ select * from public.advance_queue((select session_id from s8)) $$, '42501', null, 'only the host advances the queue');
select pg_temp.as_user('e0000000-0000-0000-0000-0000000000e3');
select throws_ok($$ select public.enqueue_song((select session_id from s8), '7e000000-0000-0000-0000-000000000001') $$, '42501', null, 'outsiders cannot queue');
select is((select count(*)::int from public.session_queue_list((select session_id from s8))), 0, 'outsiders cannot see the queue');
select pg_temp.as_user('e0000000-0000-0000-0000-0000000000e1');
select is((select track_id from public.advance_queue((select session_id from s8))), '7e000000-0000-0000-0000-000000000001'::uuid, 'host starts the first song');
select is((select track_id from public.advance_queue((select session_id from s8))), '7e000000-0000-0000-0000-000000000002'::uuid, 'host moves on to the next');
select is((select count(*)::int from public.session_queue_list((select session_id from s8))), 1, 'finished songs leave the list');

-- ---------------------------------------------------------------- friends
select is((select count(*)::int from public.search_people('Pally')), 1, 'search finds signed-up people, not guests');
select is((select relationship from public.search_people('Pally')), 'none', 'not friends yet');
select lives_ok($$ insert into public.friendships (friend_id) values ('e0000000-0000-0000-0000-0000000000e2') $$, 'host sends a request');
select is((select relationship from public.search_people('Pally')), 'requested', 'request shows as sent');
select pg_temp.as_user('e0000000-0000-0000-0000-0000000000e2');
select is((select direction from public.my_friends()), 'incoming', 'pal sees an incoming request');
update public.friendships set status = 'accepted' where user_id = 'e0000000-0000-0000-0000-0000000000e1';
select is((select earned_at is not null from public.my_achievements() where id = 'first_friend'), true, 'accepting awards Duet Partner');

-- ---------------------------------------------------------------- device sign-in codes are server-only
select throws_ok($$ select * from public.device_codes $$, '42501', null, 'apps cannot read device codes');
select throws_ok($$ insert into public.device_codes (device_code, user_code, platform) values ('x', 'AAAAAA', 'tvos') $$, '42501', null, 'apps cannot create device codes');

select * from finish();
rollback;
