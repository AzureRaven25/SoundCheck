'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { RotateCcw, Share2, Trophy } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Confetti } from './Cheers';

export interface ScoreView {
  name: string;
  color: string;
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  pitch: number; timing: number; rhythm: number; stability: number;
  duration?: number; transitions?: number;
  /** v1.2: expression (vibrato, dynamics) and the bonus points it earned; mode says what the score judged */
  expression?: number; bonus?: number; mode?: 'melody' | 'lyrics';
  feedback: string[];
  performance_id?: string | null;
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
export function Results({ scores, trackId, onAgain, error, group, guests, battle }: { battle?: boolean; scores: ScoreView[] | null; trackId: string; onAgain: () => void; error?: string | null; group?: { score: number; grade: string; singers: number } | null; guests?: { score: number; grade: string; singers: number } | null }) {
  const [board, setBoard] = useState<Row[]>([]);
  const [badges, setBadges] = useState<{ title: string; tier: string }[]>([]);
  const [xp, setXp] = useState(0);
  useEffect(() => {
    const ids = (scores ?? []).map((s) => s.performance_id).filter((x): x is string => !!x);
    if (!ids.length) return;
    // XP this performance earned (only your own; RLS hides other singers')
    void supabaseBrowser().from('xp_events').select('amount').in('performance_id', ids)
      .then(({ data }) => setXp((data ?? []).reduce((a, r) => a + (r as { amount: number }).amount, 0)));
    // badges this performance just unlocked (awarded by a database trigger when the score was saved)
    void supabaseBrowser().from('user_achievements').select('achievements(title, tier)').in('performance_id', ids)
      .then(({ data }) => setBadges(((data ?? []) as unknown as { achievements: { title: string; tier: string } | null }[]).flatMap((r) => (r.achievements ? [r.achievements] : []))));
  }, [scores]);
  useEffect(() => {
    if (!scores) return;
    void supabaseBrowser().rpc('track_leaderboard', { p_track_id: trackId, p_scope: 'global', p_limit: 5 })
      .then(({ data }) => setBoard((data as Row[] | null) ?? []));
  }, [scores, trackId]);

  const celebrate = !!scores?.some((s) => s.grade === 'S' || s.grade === 'A');
  const solo = (scores?.length ?? 1) <= 1;
  return (
    <div className="mx-auto w-full max-w-5xl px-4" role="dialog" aria-label="Results">
      {celebrate && <Confetti />}
      <h2 className="mb-4 text-center font-display text-3xl font-extrabold tracking-tight md:text-4xl">SoundCheck Score</h2>
      {error && <p role="alert" className="mb-6 text-center text-danger-400">{error}</p>}
      {battle && scores && scores.length >= 2 && (() => {
        const sorted = [...scores].sort((a, b) => b.score - a.score);
        const [w, r] = [sorted[0]!, sorted[1]!];
        return (
          <p role="status" aria-label="Battle result" className="mx-auto mb-5 w-fit animate-stamp rounded-2xl bg-gold-400/15 px-5 py-2 text-center font-display text-2xl font-extrabold text-gold-400">
            {w.score === r.score ? `It’s a tie at ${w.score}!` : `🏆 ${w.name} wins by ${w.score - r.score} point${w.score - r.score === 1 ? '' : 's'}!`}
          </p>
        );
      })()}
      {/* one singer on a wide screen: the card beside XP, badges, leaderboard and actions, so it all fits on screen */}
      <div className={clsx(solo && 'md:mx-auto md:grid md:max-w-4xl md:grid-cols-[minmax(0,1fr)_20rem] md:items-start md:gap-6')}>
      {!scores ? (
        <p className="text-center text-ink-300">Scoring your performance…</p>
      ) : (
        <div className={clsx('grid gap-6', scores.length > 1 ? 'md:grid-cols-2' : 'mx-auto w-full max-w-md')}>
          {scores.map((s, i) => (
            <div key={`${s.name}-${i}`} className="rounded-2xl bg-ink-850/90 p-5 shadow-lift ring-1 ring-ink-700">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-lg font-bold" style={{ color: s.color }}>{s.name}</p>
                <span className={clsx('animate-stamp rounded-xl bg-gradient-to-br px-4 py-1 font-display text-3xl font-black text-ink-950', GRADE_COLOR[s.grade])} style={{ animationDelay: '1.3s' }}>{s.grade}</span>
              </div>
              <p className="mb-4 flex items-end gap-3 font-display text-6xl font-black tabular-nums tracking-tight md:text-7xl">
                <CountUp to={s.score} />
                {!!s.bonus && s.bonus >= 0.5 && <span className="mb-2 rounded-full bg-gold-400/15 px-3 py-1 text-base font-bold tracking-normal text-gold-400">+{s.bonus.toFixed(1)} bonus</span>}
              </p>
              <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                <Bar label={s.mode === 'lyrics' ? 'Intonation' : 'Pitch'} value={s.pitch} /><Bar label="Timing" value={s.timing} />
                <Bar label="Rhythm" value={s.rhythm} />
                {s.duration != null && <Bar label={s.mode === 'lyrics' ? 'Lines sung' : 'Duration'} value={s.duration} />}
                {s.transitions != null && s.mode !== 'lyrics' && <Bar label="Transitions" value={s.transitions} />}
                <Bar label="Stability" value={s.stability} />
                {s.expression != null && <Bar label="Expression" value={s.expression} />}
              </div>
              <ul className="mt-4 space-y-1 text-sm text-ink-300">{s.feedback.map((f) => <li key={f}>• {f}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      <div className={clsx(solo && 'md:[&>*:first-child]:mt-0')}>
      {xp > 0 && <p className="mx-auto mt-4 w-fit rounded-full bg-pink-500/15 px-4 py-1.5 text-sm font-bold text-pink-400" role="status">+{xp} XP</p>}
      {guests && (
        <div className="mx-auto mt-4 flex max-w-md items-center justify-between rounded-2xl bg-ink-850/90 p-4 ring-1 ring-cyan-400/40" role="status" aria-label="Guest score">
          <div><p className="text-xs font-bold uppercase tracking-widest text-ink-300">Guests combined · {guests.singers} phone{guests.singers === 1 ? '' : 's'}</p>
            <p className="font-display text-4xl font-black tabular-nums">{guests.score}</p>
            <p className="text-xs text-ink-300">Saved to your account (guests aren’t logged in)</p></div>
          <span className="rounded-xl bg-cyan-400 px-4 py-1 font-display text-3xl font-black text-ink-950">{guests.grade}</span>
        </div>
      )}
      {group && (
        <div className="mx-auto mt-6 flex max-w-md items-center justify-between rounded-2xl bg-ink-850/90 p-5 ring-1 ring-pink-500/40" role="status" aria-label="Group score">
          <div><p className="text-xs font-bold uppercase tracking-widest text-ink-300">Group score · {group.singers} singers</p><p className="font-display text-5xl font-black tabular-nums">{group.score}</p></div>
          <span className="stage-gradient rounded-xl px-4 py-1 font-display text-3xl font-black text-ink-950">{group.grade}</span>
        </div>
      )}
      {badges.length > 0 && (
        <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2" role="status" aria-label="New achievements">
          {badges.map((b) => (
            <span key={b.title} className="flex items-center gap-1.5 rounded-full bg-gold-400/15 px-3 py-1.5 text-sm font-bold text-gold-400"><Trophy size={14} /> New badge: {b.title}</span>
          ))}
        </div>
      )}
      {board.length > 0 && (
        <div className="mx-auto mt-5 max-w-md rounded-2xl bg-ink-850/70 p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-ink-300"><Trophy size={16} /> Top singers on this song</p>
          <ol className="space-y-1 text-sm">
            {board.map((r) => (
              <li key={`${r.rank}-${r.display_name}`} className="flex justify-between"><span>{r.rank}. {r.display_name}</span><span className="font-bold tabular-nums">{r.score}</span></li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-3 pb-2">
        <button type="button" onClick={onAgain} className="flex items-center gap-2 rounded-full bg-pink-500 px-6 py-3 font-bold text-ink-950 hover:scale-105"><RotateCcw size={18} /> Sing again</button>
        {scores?.[0] && <ShareScore trackId={trackId} score={scores[0].score} grade={scores[0].grade} />}
        <Link href={`/track/${trackId}`} className="rounded-full border border-ink-700 px-6 py-3 font-bold hover:border-ink-300">Back to song</Link>
      </div>
      </div>
      </div>
    </div>
  );
}

/** Share a score: the phone's share sheet when there is one, otherwise copy the text and link. */
function ShareScore({ trackId, score, grade }: { trackId: string; score: number; grade: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${location.origin}/track/${trackId}`;
    const title = document.title.replace(/ · SoundCheck$/, '');
    const text = `I scored ${score} (${grade}) singing ${title} on SoundCheck. Can you beat it?`;
    try {
      if (navigator.share) { await navigator.share({ title: 'SoundCheck', text, url }); return; }
    } catch { /* closed the sheet, or not allowed: fall back to copying */ }
    await navigator.clipboard?.writeText(`${text} ${url}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  return (
    <button type="button" onClick={() => void share()} className="flex items-center gap-2 rounded-full border border-ink-700 px-6 py-3 font-bold hover:border-ink-300">
      <Share2 size={18} aria-hidden /> {copied ? 'Copied!' : 'Share score'}
    </button>
  );
}
