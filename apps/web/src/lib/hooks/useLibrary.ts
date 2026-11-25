'use client';
import { create } from 'zustand';
import { supabaseBrowser } from '../supabase/client';

export interface PlaylistSummary {
  id: string;
  title: string;
  is_public: boolean;
  cover_url: string | null;
}

interface LibraryStore {
  userId: string | null;
  favorites: Set<string>;
  playlists: PlaylistSummary[];
  loaded: boolean;
  load: (userId: string | null) => Promise<void>;
  toggleFavorite: (trackId: string) => Promise<boolean>;
  refreshPlaylists: () => Promise<void>;
  createPlaylist: (title: string) => Promise<string | null>;
  /** 'exists' when the song is already in that playlist (each song appears once) */
  addToPlaylist: (playlistId: string, trackId: string) => Promise<'added' | 'exists' | 'error'>;
}

/** The signed-in user's favorites + playlists, shared by every component that shows a heart or a playlist menu. */
export const useLibrary = create<LibraryStore>((set, get) => ({
  userId: null,
  favorites: new Set(),
  playlists: [],
  loaded: false,

  load: async (userId) => {
    if (!userId) {
      set({ userId: null, favorites: new Set(), playlists: [], loaded: true });
      return;
    }
    if (get().userId === userId && get().loaded) return;
    const sb = supabaseBrowser();
    const [fav, pl] = await Promise.all([
      sb.from('favorites').select('track_id').eq('user_id', userId),
      sb.from('playlists').select('id, title, is_public, cover_url').eq('owner_id', userId).order('updated_at', { ascending: false }),
    ]);
    set({ userId, favorites: new Set((fav.data ?? []).map((f) => f.track_id)), playlists: pl.data ?? [], loaded: true });
  },

  toggleFavorite: async (trackId) => {
    const { userId, favorites } = get();
    if (!userId) return false;
    const sb = supabaseBrowser();
    const on = !favorites.has(trackId);
    const nextSet = new Set(favorites);
    if (on) nextSet.add(trackId);
    else nextSet.delete(trackId);
    set({ favorites: nextSet }); // optimistic
    const { error } = on
      ? await sb.from('favorites').insert({ track_id: trackId })
      : await sb.from('favorites').delete().eq('user_id', userId).eq('track_id', trackId);
    if (error) set({ favorites }); // roll back
    return !error;
  },

  refreshPlaylists: async () => {
    const { userId } = get();
    if (!userId) return;
    const { data } = await supabaseBrowser().from('playlists').select('id, title, is_public, cover_url')
      .eq('owner_id', userId).order('updated_at', { ascending: false });
    set({ playlists: data ?? [] });
  },

  createPlaylist: async (title) => {
    const { data, error } = await supabaseBrowser().from('playlists').insert({ title }).select('id').single();
    if (error) return null;
    await get().refreshPlaylists();
    return data.id;
  },

  addToPlaylist: async (playlistId, trackId) => {
    const sb = supabaseBrowser();
    const { data: last } = await sb.from('playlist_tracks').select('position').eq('playlist_id', playlistId)
      .order('position', { ascending: false }).limit(1).maybeSingle();
    const { count } = await sb.from('playlist_tracks').select('id', { count: 'exact', head: true }).eq('playlist_id', playlistId).eq('track_id', trackId);
    if (count) return 'exists';
    const { error } = await sb.from('playlist_tracks').insert({ playlist_id: playlistId, track_id: trackId, position: (last?.position ?? 0) + 1 });
    if (error) return error.code === '23505' ? 'exists' : 'error';   // unique (playlist, song): added twice at once
    return 'added';
  },
}));
