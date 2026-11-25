-- Leaderboards are public: visitors see the top singers (overall and per song) before signing up. Only people who
-- opted in (show_on_leaderboards) and aren't guests are listed, exactly as before; the functions now run with their
-- owner's rights so that filter, not the visitor's session, decides what's visible. 'friends' scope needs a login.
alter function public.global_leaderboard(text, integer) security definer;
alter function public.track_leaderboard(uuid, text, integer) security definer;
grant execute on function public.global_leaderboard(text, integer), public.track_leaderboard(uuid, text, integer) to anon;
