'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Flame, Target } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Progress { xp: number; level: number; level_floor: number; next_level_xp: number; current_streak: number; best_streak: number; songs_today: number }
interface Challenge { id: string; kind: 'daily' | 'weekly'; title: string; target: number; progress: number; xp_reward: number; ends_on: string; completed: boolean }

/** Level, XP to the next level, singing streak, and today's / this week's challenges. */
export function ProgressPanel() {
  const [p, setP] = useState<Progress | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  useEffect(() => {
    const sb = supabaseBrowser();
    void sb.rpc('my_progress').then(({ data }) => setP((data as Progress[] | null)?.[0] ?? null));
    void sb.rpc('my_challenges').then(({ data }) => setChallenges((data as Challenge[] | null) ?? []));
  }, []);
  if (!p) return null;
  const span = Math.max(1, p.next_level_xp - p.level_floor);
  const pct = Math.min(1, (p.xp - p.level_floor) / span);
  return (
    <section aria-label="Your progress" className="mb-10 grid gap-4 md:grid-cols-[1.2fr_1fr]">
      <div className="rounded-2xl bg-ink-900 p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink-300">Level</p>
            <p className="font-display text-5xl font-black tabular-nums" data-testid="level">{p.level}</p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-1.5 font-bold text-gold-400"><Flame size={18} /> {p.current_streak}-day streak</p>
            <p className="text-xs text-ink-500">Best {p.best_streak} · {p.songs_today} song{p.songs_today === 1 ? '' : 's'} today</p>
          </div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={span} aria-valuenow={p.xp - p.level_floor}>
          <div className="stage-gradient h-full rounded-full" style={{ width: `${pct * 100}%` }} />
        </div>
        <p className="mt-2 text-xs text-ink-300"><b className="text-ink-50">{p.xp.toLocaleString()} XP</b> · {(p.next_level_xp - p.xp).toLocaleString()} to level {p.level + 1}</p>
      </div>
      <div className="rounded-2xl bg-ink-900 p-5">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-300">Challenges</p>
        <ul className="space-y-3" aria-label="Challenges">
          {challenges.map((c) => (
            <li key={c.id}>
              <div className="flex items-center gap-2 text-sm">
                {c.completed ? <CheckCircle2 size={16} className="text-success-400" /> : <Target size={16} className="text-pink-400" />}
                <span className="min-w-0 flex-1 truncate font-bold">{c.title}</span>
                <span className="text-xs text-ink-300">{c.kind === 'daily' ? 'Today' : 'This week'} · +{c.xp_reward} XP</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className={c.completed ? 'h-full bg-success-400' : 'stage-gradient h-full'} style={{ width: `${(c.progress / c.target) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
