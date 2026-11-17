-- SoundCheck progression tests: XP, levels, streaks, challenges.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.perf(uid uuid, track uuid, s integer, pitch real, days_ago integer) returns void language sql as $$
  insert into public.performances (user_id, track_id, score, pitch_score, timing_score, rhythm_score, stability_score, grade, scoring_version, created_at)
  values (uid, track, s, pitch, 0.8, 0.8, 0.8, case when s >= 95 then 'S' when s >= 85 then 'A' when s >= 70 then 'B' when s >= 55 then 'C' else 'D' end,
          '1.1.0', now() - make_interval(days => days_ago))
$$;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, is_anonymous) values
  ('f0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'xp@test.dev', '{"display_name":"Xp"}', false),
  ('f0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{"display_name":"Guest"}', true);
insert into public.tracks (id, title, artist_credit) values
  ('7f000000-0000-0000-0000-000000000001', 'Prog One', 'T'), ('7f000000-0000-0000-0000-000000000002', 'Prog Two', 'T');

select is(public.level_for_xp(0), 1, 'level 1 at 0 XP');
select is(public.level_for_xp(100), 2, 'level 2 at 100 XP');
select is(public.level_for_xp(8100), 10, 'level 10 at 8,100 XP');

-- a first song: 10 + 80/4 = 30 XP, plus 15 for a new song
select pg_temp.perf('f0000000-0000-0000-0000-0000000000f1', '7f000000-0000-0000-0000-000000000001', 80, 0.9, 0);
select is((select xp from public.profiles where id = 'f0000000-0000-0000-0000-0000000000f1'), 45 + coalesce((select sum(xp_reward)::integer from public.challenges c
  join public.challenge_completions cc on cc.challenge_id = c.id where cc.user_id = 'f0000000-0000-0000-0000-0000000000f1'), 0), 'XP for the song, the new-song bonus and any completed challenge');
-- singing it again: no new-song bonus
select pg_temp.as_admin();
create temp table before as select xp from public.profiles where id = 'f0000000-0000-0000-0000-0000000000f1';
select pg_temp.perf('f0000000-0000-0000-0000-0000000000f1', '7f000000-0000-0000-0000-000000000001', 40, 0.5, 0);
select cmp_ok((select xp from public.profiles where id = 'f0000000-0000-0000-0000-0000000000f1') - (select xp from before), '>=', 20, 'a repeat still earns XP (10 + 40/4)');
select is((select count(*)::int from public.xp_events where user_id = 'f0000000-0000-0000-0000-0000000000f1' and reason = 'new_song'), 1, 'the new-song bonus is paid once per song');

-- streaks: yesterday and the day before as well → 3 days
select pg_temp.perf('f0000000-0000-0000-0000-0000000000f1', '7f000000-0000-0000-0000-000000000002', 70, 0.8, 1);
select pg_temp.perf('f0000000-0000-0000-0000-0000000000f1', '7f000000-0000-0000-0000-000000000002', 70, 0.8, 2);
select pg_temp.as_user('f0000000-0000-0000-0000-0000000000f1');
select is((select current_streak from public.my_progress()), 3, 'three days in a row');
select is((select earned_at is not null from public.my_achievements() where id = 'streak_3'), true, 'On a Roll badge');
select cmp_ok((select level from public.my_progress()), '>=', 1, 'my_progress reports a level');
select is((select count(*)::int from public.my_challenges()), 2, 'one daily and one weekly challenge are active');
select throws_ok($$ update public.profiles set xp = 999999 where id = 'f0000000-0000-0000-0000-0000000000f1' $$, '42501', null, 'users cannot edit their XP');
select is((select count(*)::int from public.xp_events where user_id <> 'f0000000-0000-0000-0000-0000000000f1'), 0, 'users only see their own XP events');

-- party guests don't build progression
select pg_temp.as_admin();
select pg_temp.perf('f0000000-0000-0000-0000-0000000000f2', '7f000000-0000-0000-0000-000000000001', 90, 0.95, 0);
select is((select xp from public.profiles where id = 'f0000000-0000-0000-0000-0000000000f2'), 0, 'guests earn no XP');
select is((select count(*)::int from public.challenge_completions where user_id = 'f0000000-0000-0000-0000-0000000000f2'), 0, 'guests complete no challenges');

select * from finish();
rollback;
