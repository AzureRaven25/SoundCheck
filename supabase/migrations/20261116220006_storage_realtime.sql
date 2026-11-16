-- SoundCheck M1 · 6/6 · Storage buckets + policies, Realtime channel authorization.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('audio',   'audio',   false, 209715200, array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/x-flac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/opus', 'audio/aiff', 'audio/x-aiff', 'application/json']),
  ('artwork', 'artwork', true,  10485760,  array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true,  5242880,   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- audio: <user-id>/... is private to that user. `shared/...` (licensed content) is readable by any signed-in user.
-- Stems and analysis files are written by the worker (service role, bypasses RLS) into the owner's folder.
create policy "audio: read own and shared" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and ((storage.foldername(name))[1] = (select auth.uid())::text or (storage.foldername(name))[1] = 'shared'));
create policy "audio: upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "audio: delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- avatars: public read (bucket is public), users write only <user-id>/...
create policy "avatars: write own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- artwork: public read via the public bucket; only the service role writes (no policy needed).

-- ---------------------------------------------------------------- Realtime: private channels "session:<uuid>"
create or replace function private.session_from_topic(topic text) returns uuid
  language plpgsql immutable set search_path = ''
  as $$
  begin
    if topic !~ '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return null;
    end if;
    return substr(topic, 9)::uuid;
  end
  $$;

create policy "session members receive" on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (private.is_session_member(private.session_from_topic(realtime.topic()))
         or private.is_session_host(private.session_from_topic(realtime.topic())))
  );
create policy "session members send" on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (private.is_session_member(private.session_from_topic(realtime.topic()))
         or private.is_session_host(private.session_from_topic(realtime.topic())))
  );
