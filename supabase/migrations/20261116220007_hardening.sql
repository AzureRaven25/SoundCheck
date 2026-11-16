-- SoundCheck M1 · 7 · Column-level update permissions + single permissive policy per action.
--
-- Row policies decide WHICH rows a user may update; these grants decide WHICH columns.
-- Without them a guest could clear profiles.is_guest (and appear on leaderboards), a session
-- member could promote themselves to host, or a friend-request recipient could rewrite the requester.

revoke update on public.profiles from anon, authenticated;
grant update (username, display_name, avatar_url, bio, vocal_low, vocal_high, show_on_leaderboards)
  on public.profiles to authenticated;

revoke update on public.session_members from anon, authenticated;
grant update (display_name, color, mic_volume, left_at, kicked) on public.session_members to authenticated;

revoke update on public.karaoke_sessions from anon, authenticated;
grant update (status, current_track_id, settings, max_members, ended_at) on public.karaoke_sessions to authenticated;

revoke update on public.friendships from anon, authenticated;
grant update (status, accepted_at) on public.friendships to authenticated;

revoke update on public.session_queue from anon, authenticated;
grant update (singer_member_ids, key_shift, position, status) on public.session_queue to authenticated;

revoke update on public.playlists from anon, authenticated;
grant update (title, description, is_public, cover_url) on public.playlists to authenticated;

revoke update on public.playlist_tracks from anon, authenticated;
grant update (position) on public.playlist_tracks to authenticated;

revoke update on public.user_preferences from anon, authenticated;
grant update (prefs) on public.user_preferences to authenticated;

-- Tables that clients never update.
revoke update on public.listening_history, public.search_history, public.favorites, public.audio_assets,
  public.karaoke_analysis, public.processing_jobs, public.performances, public.user_achievements
  from anon, authenticated;
revoke insert, update, delete on public.artists, public.albums, public.album_artists, public.tracks,
  public.track_artists, public.track_recordings, public.artwork, public.lyrics, public.achievements
  from anon, authenticated;

-- One permissive policy per (table, role, action), as the Supabase performance advisor recommends.
drop policy "edit tracks of own playlists" on public.playlist_tracks;
create policy "add tracks to own playlists" on public.playlist_tracks for insert to authenticated
  with check (private.owns_playlist(playlist_id));
create policy "reorder tracks in own playlists" on public.playlist_tracks for update to authenticated
  using (private.owns_playlist(playlist_id)) with check (private.owns_playlist(playlist_id));
create policy "remove tracks from own playlists" on public.playlist_tracks for delete to authenticated
  using (private.owns_playlist(playlist_id));

drop policy "update own membership" on public.session_members;
drop policy "host manages members" on public.session_members;
create policy "member or host updates membership" on public.session_members for update to authenticated
  using (user_id = (select auth.uid()) or private.is_session_host(session_id))
  -- a kicked member can't un-kick themselves; only the host can
  with check (private.is_session_host(session_id) or (user_id = (select auth.uid()) and not kicked));
