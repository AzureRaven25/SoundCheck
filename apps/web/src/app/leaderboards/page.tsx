'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Trophy } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useUser } from '@/lib/hooks/useUser';
import { Avatar, SignInGate } from '@/components/social/SignInGate';

interface Row { rank: number; user_id: string; display_name: string; avatar_url: string | null; avg_best: number; tracks_sung: number }
interface Stats { performances: number; tracks_sung: number; avg_score: number | null; best_score: number | null; avg_pitch: number | null; avg_timing: number | null; avg_rhythm: number | null; avg_stability: number | null; achievements: number; songs_sung?: number; minutes_sung?: number }

function Boards() {
  const user = useUser();
  const [scope, setScope] = useState<'global' | 'friends'>('global');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    setRows(null);
    void supabaseBrowser().rpc('global_leaderboard', { p_scope: scope, p_limit: 50 }).then(({ data }) => setRows((data as Row[] | null) ?? []));
  }, [scope]);
  useEffect(() => { void supabaseBrowser().rpc('my_stats').then(({ data }) => setStats((data as Stats[] | null)?.[0] ?? null)); }, []);
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}`);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Leaderboards</h1>
          <p className="mt-1 text-ink-300">Ranked by the average of each singer’s best score per song (3 songs or more).</p>
        </div>
        <div role="tablist" aria-label="Leaderboard scope" className="inline-flex rounded-full bg-ink-850 p-1">
          {(['global', 'friends'] as const).map((s) => (
            <button key={s} role="tab" type="button" aria-selected={scope === s} onClick={() => setScope(s)}
              className={clsx('rounded-full px-4 py-1.5 text-sm font-bold capitalize', scope === s ? 'bg-ink-50 text-ink-950' : 'text-ink-300')}>{s}</button>
          ))}
        </div>
      </header>

      {stats && (
        <section aria-label="Your stats" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Songs sung', stats.songs_sung ?? stats.performances], ['Best score', stats.best_score ?? '—'], ['Average', stats.avg_score == null ? '—' : Math.round(stats.avg_score)], ['Badges', stats.achievements],
            ['Pitch', pct(stats.avg_pitch)], ['Timing', pct(stats.avg_timing)], ['Rhythm', pct(stats.avg_rhythm)], ['Stability', pct(stats.avg_stability)]].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-ink-900 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-ink-300">{k}</p>
              <p className="mt-1 font-display text-3xl font-black tabular-nums">{v}</p>
            </div>
          ))}
        </section>
      )}

      <section aria-label={`${scope} leaderboard`}>
        {rows === null ? <p className="text-ink-500">Loading…</p> : rows.length === 0 ? (
          <div className="rounded-xl bg-ink-900 p-8 text-center text-ink-300">
            <Trophy className="mx-auto mb-3 text-gold-400" />
            {scope === 'friends' ? 'No ranked friends yet. Each singer needs scores on 3 different songs.' : 'No ranked singers yet. Sing 3 different songs to get on the board.'}
          </div>
        ) : (
          <ol className="divide-y divide-ink-800 overflow-hidden rounded-xl bg-ink-900">
            {rows.map((r) => (
              <li key={r.user_id} className={clsx('flex items-center gap-4 p-3', r.user_id === user?.id && 'bg-ink-850')}>
                <span className={clsx('w-8 text-center font-display text-xl font-black tabular-nums', r.rank <= 3 ? 'text-gold-400' : 'text-ink-300')}>{r.rank}</span>
                <Avatar name={r.display_name} url={r.avatar_url} />
                <p className="flex-1 truncate font-bold">{r.display_name}{r.user_id === user?.id && <span className="ml-2 text-xs text-pink-400">you</span>}</p>
                <span className="text-sm text-ink-300">{r.tracks_sung} songs</span>
                <span className="w-14 text-right font-display text-2xl font-black tabular-nums">{Math.round(r.avg_best)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export default function LeaderboardsPage() {
  return <SignInGate next="/leaderboards" what="leaderboards" title="Leaderboards" why="See the top singers and how your scores stack up. Log in to compete."><Boards /></SignInGate>;
}
