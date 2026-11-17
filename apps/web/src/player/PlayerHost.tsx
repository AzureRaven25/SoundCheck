'use client';
import { useEffect, useRef } from 'react';
import { resolveAudio } from '@/lib/audio';
import { supabaseBrowser } from '@/lib/supabase/client';
import { usePlayer, useCurrentTrack } from './store';

/**
 * Owns the single <audio> element: loads the current track's best source, mirrors play/pause/seek/
 * volume from the store, wires the Media Session API (lock screen, headset and keyboard media keys),
 * and records listening history for signed-in users.
 */
export function PlayerHost() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const track = useCurrentTrack();
  const playing = usePlayer((s) => s.playing);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const restartToken = usePlayer((s) => s.restartToken);
  const reloadToken = usePlayer((s) => s.reloadToken);
  const seekRequest = usePlayer((s) => s.seekRequest);
  const report = usePlayer((s) => s._report);
  const listened = useRef<{ trackId: string; ms: number; kind: string } | null>(null);

  // Flush listening history for the song that's ending.
  const flushHistory = () => {
    const l = listened.current;
    listened.current = null;
    if (!l || l.ms < 5000) return; // ignore skips
    const sb = supabaseBrowser();
    void sb.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      void sb.from('listening_history').insert({
        track_id: l.trackId, ms_played: Math.round(l.ms), platform: 'web', mode: l.kind === 'preview' ? 'preview' : 'listen',
      });
    });
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
    resolveAudio(track.id)
      .then((src) => {
        if (cancelled) return;
        if (!src) {
          report({ load: 'unavailable', sourceKind: null, attributionUrl: null, sourceLabel: null, playing: false });
          return;
        }
        listened.current = { trackId: track.id, ms: 0, kind: src.kind };
        el.src = src.url;
        report({ sourceKind: src.kind, attributionUrl: src.attributionUrl, sourceLabel: src.sourceLabel });
        if (usePlayer.getState().playing) void el.play().catch(() => report({ playing: false }));
      })
      .catch(() => !cancelled && report({ load: 'error', playing: false }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, reloadToken]);

  useEffect(() => {
    const el = audio.current;
    if (!el || !el.src) return;
    if (playing) void el.play().catch(() => report({ playing: false }));
    else el.pause();
  }, [playing, report]);

  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume;
      audio.current.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    const el = audio.current;
    if (el && restartToken) {
      el.currentTime = 0;
      void el.play().catch(() => {});
    }
  }, [restartToken]);

  useEffect(() => {
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
    <audio
      ref={audio}
      preload="auto"
      data-testid="player-audio"
      onCanPlay={() => report({ load: 'ready' })}
      onTimeUpdate={(e) => {
        const t = e.currentTarget.currentTime;
        const prev = usePlayer.getState().position;
        if (listened.current && t > prev && t - prev < 2) listened.current.ms += (t - prev) * 1000;
        report({ position: t });
      }}
      onDurationChange={(e) => isFinite(e.currentTarget.duration) && report({ duration: e.currentTarget.duration })}
      onEnded={() => usePlayer.getState().nextTrack(true)}
      onError={() => usePlayer.getState().load !== 'idle' && report({ load: 'error', playing: false })}
    />
  );
}
