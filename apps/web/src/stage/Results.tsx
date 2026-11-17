'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { RotateCcw, Trophy } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';

export interface ScoreView {
  name: string;
  color: string;
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  pitch: number; timing: number; rhythm: number; stability: number;
  feedback: string[];
}

const GRADE_COLOR: Record<ScoreView['grade'], string> = {
  S: 'from-gold-400 to-pink-500', A: 'from-pink-500 to-violet-500', B: 'from-violet-500 to-cyan-400', C: 'from-cyan-400 to-success-400', D: 'from-ink-500 to-ink-700',
};

function CountUp({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 1400);
      setV(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v}</>;
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-bold uppercase tracking-widest text-ink-300"><span>{label}</span><span>{Math.round(value * 100)}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-700"><div className="stage-gradient h-full rounded-full transition-[width] duration-1000" style={{ width: `${value * 100}%` }} /></div>
    </div>
  );
}

interface Row { rank: number; display_name: string; score: number; grade: string }

/** SoundCheck Score results: one card per singer, then the song's leaderboard. */
export function Results({ scores, trackId, onAgain, error }: { scores: ScoreView[] | null; trackId: string; onAgain: () => void; error?: string | null }) {
  const [board, setBoard] = useState<Row[]>([]);
  useEffect(() => {
    if (!scores) return;
    void supabaseBrowser().rpc('track_leaderboard', { p_track_id: trackId, p_scope: 'global', p_limit: 5 })
      .then(({ data }) => setBoard((data as Row[] | null) ?? []));
  }, [scores, trackId]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4" role="dialog" aria-label="Results">
      <h2 className="mb-8 text-center font-display text-5xl font-extrabold tracking-tight">SoundCheck Score</h2>
      {error && <p role="alert" className="mb-6 text-center text-danger-400">{error}</p>}
      {!scores ? (
        <p className="text-center text-ink-300">Scoring your performance…</p>
      ) : (
        <div className={clsx('grid gap-6', scores.length > 1 ? 'md:grid-cols-2' : 'mx-auto max-w-md')}>
          {scores.map((s, i) => (
            <div key={`${s.name}-${i}`} className="rounded-2xl bg-ink-850/90 p-6 shadow-lift ring-1 ring-ink-700">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-lg font-bold" style={{ color: s.color }}>{s.name}</p>
                <span className={clsx('rounded-xl bg-gradient-to-br px-4 py-1 font-display text-3xl font-black text-ink-950', GRADE_COLOR[s.grade])}>{s.grade}</span>
              </div>
              <p className="mb-6 font-display text-8xl font-black tabular-nums tracking-tight"><CountUp to={s.score} /></p>
              <div className="space-y-3">
                <Bar label="Pitch" value={s.pitch} /><Bar label="Timing" value={s.timing} />
                <Bar label="Rhythm" value={s.rhythm} /><Bar label="Stability" value={s.stability} />
              </div>
              <ul className="mt-6 space-y-1 text-sm text-ink-300">{s.feedback.map((f) => <li key={f}>• {f}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {board.length > 0 && (
        <div className="mx-auto mt-8 max-w-md rounded-2xl bg-ink-850/70 p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-ink-300"><Trophy size={16} /> Top singers on this song</p>
          <ol className="space-y-1 text-sm">
            {board.map((r) => (
              <li key={`${r.rank}-${r.display_name}`} className="flex justify-between"><span>{r.rank}. {r.display_name}</span><span className="font-bold tabular-nums">{r.score}</span></li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-8 flex justify-center gap-4">
        <button type="button" onClick={onAgain} className="flex items-center gap-2 rounded-full bg-pink-500 px-6 py-3 font-bold text-ink-950 hover:scale-105"><RotateCcw size={18} /> Sing again</button>
        <Link href={`/track/${trackId}`} className="rounded-full border border-ink-700 px-6 py-3 font-bold hover:border-ink-300">Back to song</Link>
      </div>
    </div>
  );
}
