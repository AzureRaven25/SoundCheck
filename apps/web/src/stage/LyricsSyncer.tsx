'use client';
/**
 * Time the lyrics yourself: play the original recording and tap (or press Space) as each line starts. The result
 * becomes this song's synced lyrics if it had none, for every singer after you.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Hand, Undo2, X } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';

export interface SyncedLine { start: number; text: string }

export function LyricsSyncer({ trackId, videoId, initial, getTime, playFromTop, pause, signedIn, onDone, onCancel }: {
  trackId: string; videoId: string | null; initial: string[]; getTime: () => number;
  playFromTop: () => void; pause: () => void; signedIn: boolean;
  onDone: (lines: SyncedLine[], applied: boolean) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initial.join('\n'));
  const [lines, setLines] = useState<string[] | null>(initial.length ? initial : null);
  const [times, setTimes] = useState<number[]>([]);
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tapRef = useRef<() => void>(() => {});

  const tap = () => {
    if (!lines || !started || times.length >= lines.length) return;
    const t = Math.max(0, +getTime().toFixed(2));
    if (times.length && t <= times[times.length - 1]!) return;
    setTimes((ts) => [...ts, t]);
  };
  useEffect(() => { tapRef.current = tap; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement | null)?.closest('input, textarea, select, button')) return;
      e.preventDefault();
      tapRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function save() {
    if (!lines) return;
    setSaving(true); setError(null);
    const synced = lines.map((l, i) => ({ start: times[i]!, text: l }));
    if (!signedIn) { onDone(synced, false); return; }
    const { data, error: err } = await supabaseBrowser().rpc('submit_synced_lyrics', { p_track_id: trackId, p_lines: synced, p_video_id: videoId ?? undefined });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onDone(synced, data === 'applied');
  }

  if (!lines) {
    return (
      <div className="w-full max-w-2xl py-4">
        <h2 className="font-display text-2xl font-bold">Add the lyrics</h2>
        <p className="mt-1 text-sm text-ink-300">No lyrics found for this song. Paste them below, one sung line per row, then tap along to time them.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} aria-label="Lyrics"
          className="mt-3 w-full rounded-xl bg-ink-850 p-3 text-sm placeholder:text-ink-500" placeholder={'First line of the song\nSecond line…'} />
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => { const ls = text.split('\n').map((l) => l.trim()).filter(Boolean); if (ls.length >= 3) setLines(ls); }}
            disabled={text.split('\n').filter((l) => l.trim()).length < 3}
            className="rounded-full bg-ink-50 px-5 py-2 text-sm font-bold text-ink-950 disabled:opacity-40">Next: tap along</button>
          <button type="button" onClick={onCancel} className="rounded-full bg-ink-800 px-5 py-2 text-sm font-bold">Cancel</button>
        </div>
      </div>
    );
  }

  const i = times.length;
  const done = i >= lines.length;
  return (
    <div className="w-full max-w-3xl py-4 text-center">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-300">Time the lyrics · line {Math.min(i + 1, lines.length)} of {lines.length}</p>
      {!started ? (
        <>
          <p className="mx-auto mt-3 max-w-xl text-ink-300">The original recording plays from the top. Tap the button (or press Space) the moment each line starts being sung.</p>
          <button type="button" onClick={() => { setStarted(true); setTimes([]); playFromTop(); }} className="stage-gradient mt-5 rounded-full px-8 py-3 font-display text-lg font-bold">Start</button>
        </>
      ) : (
        <>
          <p className="mt-4 min-h-[3rem] font-display text-[clamp(1.5rem,4vw,3rem)] font-extrabold leading-tight" aria-live="polite">{done ? 'All lines timed!' : lines[i]}</p>
          <p className="mt-2 min-h-[1.5rem] text-ink-500">{done ? '' : lines[i + 1] ?? ''}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {!done && (
              <button type="button" onClick={tap} className="stage-gradient flex items-center gap-2 rounded-full px-10 py-4 font-display text-xl font-bold" aria-label="Tap: this line starts now">
                <Hand size={22} /> Tap
              </button>
            )}
            <button type="button" onClick={() => setTimes((ts) => ts.slice(0, -1))} disabled={!i} className="flex items-center gap-1 rounded-full bg-ink-800 px-4 py-2 text-sm font-bold disabled:opacity-30">
              <Undo2 size={14} /> Undo
            </button>
            {done && (
              <button type="button" onClick={() => { pause(); void save(); }} disabled={saving} className="flex items-center gap-1 rounded-full bg-ink-50 px-5 py-2 text-sm font-bold text-ink-950 disabled:opacity-50">
                <Check size={16} /> {signedIn ? 'Save for everyone' : 'Use these timings'}
              </button>
            )}
            <button type="button" onClick={() => { pause(); onCancel(); }} className="flex items-center gap-1 rounded-full bg-ink-800 px-4 py-2 text-sm font-bold"><X size={14} /> Cancel</button>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-danger-400">{error}</p>}
        </>
      )}
    </div>
  );
}
