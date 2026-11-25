'use client';
/**
 * YouTube as a full-length *listening* source for the site's player (research.md §3): YouTube's own IFrame
 * player, visible (≥ 200 px, as YouTube's required minimum functionality asks), with its branding and ads.
 * Its audio is never captured, separated or processed, so these songs aren't karaoke sources.
 */

// Minimal IFrame Player API surface.
export interface YTPlayer {
  playVideo(): void; pauseVideo(): void; seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number; getDuration(): number; setVolume(v: number): void; mute(): void; unMute(): void;
  loadVideoById(id: string): void; destroy(): void;
  getPlayerState(): number; getVolume(): number; isMuted(): boolean; cueVideoById(id: string): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, o: Record<string, unknown>) => YTPlayer; PlayerState: { ENDED: number; PLAYING: number; PAUSED: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let api: Promise<void> | null = null;
export function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  api ??= new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return api;
}

/** The 11-character video id from a YouTube link (watch, youtu.be, shorts, embed, music.youtube) or a bare id. */
export function videoIdFrom(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
    const id = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).pop() ?? '';
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

// Links people pasted on song pages are remembered on this device (they never go to SoundCheck's database).
const CHOICES = 'soundcheck.youtube.v1';
export function rememberVideo(trackId: string, videoId: string) {
  try {
    const m = JSON.parse(localStorage.getItem(CHOICES) ?? '{}') as Record<string, string>;
    m[trackId] = videoId;
    localStorage.setItem(CHOICES, JSON.stringify(m));
  } catch { /* storage unavailable */ }
}
export function rememberedVideo(trackId: string): string | null {
  try { return (JSON.parse(localStorage.getItem(CHOICES) ?? '{}') as Record<string, string>)[trackId] ?? null; } catch { return null; }
}
