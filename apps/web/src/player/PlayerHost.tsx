'use client';
import { persistPlayer } from './persist';
import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi, type YTPlayer } from './youtube';
import { resolveAudio } from '@/lib/audio';
import { supabaseBrowser } from '@/lib/supabase/client';
import { usePlayer, useCurrentTrack } from './store';
import { suggestAfter } from './autoplay';

/**
 * Owns the single <audio> element: loads the current track's best source, mirrors play/pause/seek/
 * volume from the store, wires the Media Session API (lock screen, headset and keyboard media keys),
 * and records listening history for signed-in users.
 */
export function PlayerHost() {
  useEffect(() => { persistPlayer(); }, []);   // restore the last queue (paused) and keep saving it
  const audio = useRef<HTMLAudioElement | null>(null);
  const track = useCurrentTrack();
  const playing = usePlayer((s) => s.playing);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const restartToken = usePlayer((s) => s.restartToken);
  const reloadToken = usePlayer((s) => s.reloadToken);
  const seekRequest = usePlayer((s) => s.seekRequest);
  const report = usePlayer((s) => s._report);
  const listened = useRef<{ trackId: string; ms: number; kind: string; recorded?: boolean } | null>(null);
  // YouTube mode: the song plays in YouTube's own (visible) player instead of the <audio> element
  const [ytId, setYtId] = useState<string | null>(null);
  const yt = useRef<YTPlayer | null>(null);
  const ytHost = useRef<HTMLDivElement | null>(null);

  // A song finished: at the end of the queue (repeat off) top it up with similar songs first, if autoplay is on.
  const endOfSong = async () => {
    const s = usePlayer.getState();
    const q = s.queue;
    const cur = q.pos >= 0 ? q.items[q.order[q.pos]!] : undefined;
    if (s.autoplay && cur && q.repeat === 'off' && q.pos + 1 >= q.order.length) {
      const more = await suggestAfter(cur, q.items.map((i) => i.id)).catch(() => []);
      for (const t of more) usePlayer.getState().addToQueue(t);
    }
    usePlayer.getState().nextTrack(true);
  };

  // Listening history: one entry per play, written once 30 s have been heard (so closing the tab mid-song still
  // counts), or when the song changes after at least 5 s.
  const recordListen = (l: { trackId: string; ms: number; kind: string; recorded?: boolean }) => {
    if (l.recorded || l.ms < 5000 || l.trackId.startsWith('server:')) return; // skips; server songs aren't catalog rows
    l.recorded = true;
    const sb = supabaseBrowser();
    void sb.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      // a query builder only runs when awaited or then'd: without .then() nothing was ever sent
      void sb.from('listening_history').insert({
        track_id: l.trackId, ms_played: Math.round(l.ms), platform: 'web', mode: l.kind === 'preview' ? 'preview' : 'listen',
      }).then(() => {}, () => {});
    });
  };
  const flushHistory = () => {
    const l = listened.current;
    listened.current = null;
    if (l) recordListen(l);
  };
  const countListen = (deltaMs: number) => {
    const l = listened.current;
    if (!l) return;
    l.ms += deltaMs;
    if (l.ms >= 30_000) recordListen(l);
  };

  // Load the source whenever the current track changes.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    flushHistory();
    if (!track) {
      el.removeAttribute('src');
      el.load();
      report({ load: 'idle', position: 0, duration: 0, sourceKind: null, attributionUrl: null, sourceLabel: null });
      return;
    }
    let cancelled = false;
    report({ load: 'loading', position: 0, duration: (track.durationMs ?? 0) / 1000 });
    const direct = track.stream ? Promise.resolve({ url: track.stream.url, kind: 'full' as const, attributionUrl: null, sourceLabel: track.stream.label }) : null;
    (direct ?? resolveAudio(track.id))
      .then((src) => {
        if (cancelled) return;
        if (!src) {
          report({ load: 'unavailable', sourceKind: null, attributionUrl: null, sourceLabel: null, playing: false });
          return;
        }
        listened.current = { trackId: track.id, ms: 0, kind: src.kind };
        if (src.kind === 'youtube' && src.videoId) {
          el.removeAttribute('src');
          el.load();
          setYtId(src.videoId);
          report({ sourceKind: 'full', attributionUrl: src.attributionUrl, sourceLabel: src.sourceLabel });
          return;
        }
        setYtId(null);
        el.src = src.url;
        report({ sourceKind: src.kind === 'youtube' ? 'full' : src.kind, attributionUrl: src.attributionUrl, sourceLabel: src.sourceLabel });
        if (usePlayer.getState().playing) void el.play().catch(() => report({ playing: false }));
      })
      .catch(() => !cancelled && report({ load: 'error', playing: false }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, reloadToken]);

  useEffect(() => {
    if (yt.current) { if (playing) yt.current.playVideo(); else yt.current.pauseVideo(); return; }
    const el = audio.current;
    if (!el || !el.src) return;
    if (playing) void el.play().catch(() => report({ playing: false }));
    else el.pause();
  }, [playing, report]);

  // YouTube player lifecycle + position/duration reporting
  useEffect(() => {
    if (!ytId) { yt.current?.destroy(); yt.current = null; return; }
    let live = true;
    void loadYouTubeApi().then(() => {
      if (!live || !ytHost.current || !window.YT) return;
      if (yt.current) { yt.current.loadVideoById(ytId); return; }
      const mount = document.createElement('div');
      ytHost.current.replaceChildren(mount);
      yt.current = new window.YT.Player(mount, {
        videoId: ytId, width: '100%', height: '100%',
        playerVars: { autoplay: usePlayer.getState().playing ? 1 : 0, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            const st = usePlayer.getState();
            yt.current?.setVolume(Math.round(st.volume * 100));
            if (st.muted) yt.current?.mute();
            if (st.playing) yt.current?.playVideo();
            report({ load: 'ready' });
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === window.YT!.PlayerState.ENDED) void endOfSong();
            if (e.data === window.YT!.PlayerState.PLAYING) report({ load: 'ready', playing: true });
          },
        },
      });
    });
    const iv = setInterval(() => {
      const p = yt.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      const t = p.getCurrentTime(), d = p.getDuration();
      const prev = usePlayer.getState().position;
      if (t > prev && t - prev < 2) countListen((t - prev) * 1000);
      report({ position: t, ...(d > 0 ? { duration: d } : {}) });
    }, 500);
    return () => { live = false; clearInterval(iv); };
  }, [ytId, report]);

  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume;
      audio.current.muted = muted;
    }
    if (yt.current && typeof yt.current.setVolume === 'function') {
      yt.current.setVolume(Math.round(volume * 100));
      if (muted) yt.current.mute(); else yt.current.unMute();
    }
  }, [volume, muted]);

  useEffect(() => {
    if (yt.current && restartToken) { yt.current.seekTo(0, true); yt.current.playVideo(); return; }
    const el = audio.current;
    if (el && restartToken) {
      el.currentTime = 0;
      void el.play().catch(() => {});
    }
  }, [restartToken]);

  useEffect(() => {
    if (yt.current && seekRequest) { yt.current.seekTo(seekRequest.to, true); return; }
    if (audio.current && seekRequest) audio.current.currentTime = seekRequest.to;
  }, [seekRequest]);

  // Media Session: OS media controls + metadata.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = track
      ? new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: 'SoundCheck',
          artwork: track.artworkUrl ? [{ src: track.artworkUrl, sizes: '1200x1200' }] : [],
        })
      : null;
    const p = usePlayer.getState;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => p().setPlaying(true)],
      ['pause', () => p().setPlaying(false)],
      ['nexttrack', () => p().nextTrack()],
      ['previoustrack', () => p().previousTrack()],
      ['seekto', (d) => d.seekTime != null && p().seek(d.seekTime)],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* unsupported action */
      }
    }
  }, [track]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  useEffect(() => () => flushHistory(), []);

  return (
    <>
    {/* YouTube's player must stay visible (≥ 200 px) while it plays: a docked mini window above the player bar */}
    <div
      ref={ytHost}
      aria-label="YouTube player"
      role="region"
      className={ytId ? 'fixed bottom-[92px] right-4 z-40 h-[200px] w-[356px] overflow-hidden rounded-xl bg-black shadow-lift ring-1 ring-ink-700' : 'hidden'}
    />
    <audio
      ref={audio}
      preload="auto"
      data-testid="player-audio"
      onCanPlay={() => report({ load: 'ready' })}
      onTimeUpdate={(e) => {
        const t = e.currentTarget.currentTime;
        const prev = usePlayer.getState().position;
        if (t > prev && t - prev < 2) countListen((t - prev) * 1000);
        report({ position: t });
      }}
      onDurationChange={(e) => isFinite(e.currentTarget.duration) && report({ duration: e.currentTarget.duration })}
      onEnded={() => void endOfSong()}
      onError={() => !yt.current && usePlayer.getState().load !== 'idle' && report({ load: 'error', playing: false })}
    />
    </>
  );
}
