'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { Loader2, MonitorPlay, Music2, Pause, Play } from 'lucide-react';
import { youtubeId } from '@soundcheck/contracts';
import { supabaseBrowser } from '@/lib/supabase/client';
import { usePlayer } from '@/player/store';

/**
 * Official full-length players that SoundCheck may not process (research.md §3): YouTube's embedded player and
 * Apple Music (MusicKit, subscribers only). They play in their own players: no karaoke, no key change.
 */
export function ListenElsewhere({ trackId, title, artist, isrcs }: { trackId: string; title: string; artist: string; isrcs: string[] }) {
  const [tab, setTab] = useState<'none' | 'youtube' | 'apple'>('none');
  const [apple, setApple] = useState<{ token: string } | null | undefined>(undefined);
  useEffect(() => {
    void supabaseBrowser().functions.invoke<{ configured: boolean; token?: string }>('apple-music', { body: {} })
      .then(({ data }) => setApple(data?.configured && data.token ? { token: data.token } : null));
  }, []);
  const pauseOurs = () => usePlayer.setState({ playing: false });   // never two songs at once

  return (
    <section aria-label="Listen elsewhere" className="mb-8 max-w-3xl">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setTab(tab === 'youtube' ? 'none' : 'youtube')} aria-expanded={tab === 'youtube'}
          className="flex items-center gap-2 rounded-full border border-ink-700 px-4 py-2 text-sm font-bold hover:border-ink-300"><MonitorPlay size={16} /> Watch on YouTube</button>
        {apple && (
          <button type="button" onClick={() => setTab(tab === 'apple' ? 'none' : 'apple')} aria-expanded={tab === 'apple'}
            className="flex items-center gap-2 rounded-full border border-ink-700 px-4 py-2 text-sm font-bold hover:border-ink-300"><Music2 size={16} /> Play on Apple Music</button>
        )}
      </div>
      {tab === 'youtube' && <YouTubePanel trackId={trackId} onPlay={pauseOurs} />}
      {tab === 'apple' && apple && <AppleMusicPanel token={apple.token} title={title} artist={artist} isrcs={isrcs} onPlay={pauseOurs} />}
    </section>
  );
}

function YouTubePanel({ trackId, onPlay }: { trackId: string; onPlay: () => void }) {
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [video, setVideo] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    void supabaseBrowser().functions.invoke<{ configured: boolean; videos: { id: string }[] }>('youtube', { body: { track_id: trackId } })
      .then(({ data }) => { setVideo(data?.videos?.[0]?.id ?? null); setState('ready'); });
  }, [trackId]);
  useEffect(() => { if (video) onPlay(); }, [video, onPlay]);
  if (state === 'loading') return <p className="mt-3 flex items-center gap-2 text-sm text-ink-300"><Loader2 size={14} className="animate-spin" /> Looking for the video…</p>;
  return (
    <div className="mt-3 space-y-3">
      {video ? (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          {/* YouTube's own player, privacy-enhanced mode. Full video with YouTube's controls and ads. */}
          <iframe title="YouTube video player" src={`https://www.youtube-nocookie.com/embed/${video}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            className="h-full w-full" referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      ) : (
        <p className="text-sm text-ink-300">Paste a YouTube or YouTube Music link for this song to play it here.</p>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const id = youtubeId(link); setBad(!id); if (id) setVideo(id); }}>
        <label htmlFor="ytlink" className="sr-only">YouTube link</label>
        <input id="ytlink" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=…"
          className="min-w-0 flex-1 rounded-full bg-ink-850 px-4 py-2 text-sm ring-1 ring-ink-700 focus:outline-none focus:ring-pink-500" />
        <button type="submit" className="rounded-full bg-ink-50 px-4 py-2 text-sm font-bold text-ink-950">{video ? 'Use this link' : 'Play'}</button>
      </form>
      {bad && <p role="alert" className="text-sm text-danger-400">That isn’t a YouTube link.</p>}
      <p className="text-xs text-ink-500">Played by YouTube. YouTube doesn’t allow separating its audio, so it can’t be used for karaoke.</p>
    </div>
  );
}

// Minimal MusicKit JS v3 surface we use.
type MK = {
  authorize(): Promise<string>; isAuthorized: boolean; storefrontId: string;
  api: { music(path: string, params?: Record<string, string>): Promise<{ data: { data: { id: string; attributes?: { name: string; artistName: string } }[] } }> };
  setQueue(o: { song: string; startPlaying?: boolean }): Promise<unknown>; play(): Promise<void>; pause(): void; isPlaying: boolean;
};
declare global { interface Window { MusicKit?: { configure(o: unknown): Promise<MK>; getInstance(): MK } } }

function AppleMusicPanel({ token, title, artist, isrcs, onPlay }: { token: string; title: string; artist: string; isrcs: string[]; onPlay: () => void }) {
  const [loaded, setLoaded] = useState(typeof window !== 'undefined' && !!window.MusicKit);
  const [msg, setMsg] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const mk = useRef<MK | null>(null);

  async function play() {
    setMsg(null);
    try {
      if (!window.MusicKit) throw new Error('MusicKit didn’t load');
      mk.current ??= await window.MusicKit.configure({ developerToken: token, app: { name: 'SoundCheck', build: '1.0' } });
      const music = mk.current;
      if (!music.isAuthorized) await music.authorize();          // Apple's sign-in; full songs need a subscription
      const sf = music.storefrontId || 'us';
      let song: string | undefined;
      for (const isrc of isrcs.slice(0, 3)) {                       // exact match by ISRC first
        const r = await music.api.music(`/v1/catalog/${sf}/songs`, { 'filter[isrc]': isrc });
        song = r.data.data[0]?.id;
        if (song) break;
      }
      if (!song) {
        const r = await music.api.music(`/v1/catalog/${sf}/search`, { term: `${artist} ${title}`, types: 'songs', limit: '1' }) as unknown as
          { data: { results: { songs?: { data: { id: string }[] } } } };
        song = r.data.results.songs?.data[0]?.id;
      }
      if (!song) { setMsg('Apple Music doesn’t seem to have this song.'); return; }
      onPlay();
      await music.setQueue({ song, startPlaying: true });
      setPlaying(true);
    } catch (e) {
      setMsg(e instanceof Error && /authoriz/i.test(e.message) ? 'Sign in to Apple Music to play full songs.' : 'Apple Music playback didn’t start.');
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-ink-850 p-4">
      <Script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" strategy="afterInteractive" onLoad={() => setLoaded(true)} />
      <button type="button" disabled={!loaded} onClick={() => (playing ? (mk.current?.pause(), setPlaying(false)) : void play())}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-50 text-ink-950 disabled:opacity-40" aria-label={playing ? 'Pause Apple Music' : 'Play on Apple Music'}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="translate-x-0.5" />}
      </button>
      <p className="min-w-0 flex-1 text-sm text-ink-300">Full song for Apple Music subscribers, played by Apple Music. Not available for karaoke (protected audio).</p>
      {msg && <p role="alert" className="w-full text-sm text-gold-400">{msg}</p>}
    </div>
  );
}
