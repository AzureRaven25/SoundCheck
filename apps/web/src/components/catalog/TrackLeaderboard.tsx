'use client';
import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { Avatar } from '@/components/social/SignInGate';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Entry { rank: number; user_id: string; display_name: string; avatar_url: string | null; score: number; grade: string; key_shift: number }

/** Best score per singer for this song (signed-in users; scores come from SoundCheck Stage). */
export function TrackLeaderboard({ trackId }: { trackId: string }) {
  const user = useUser();
  const [scope, setScope] = useState<'global' | 'friends'>('global');
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => {
    if (!user || user.is_anonymous) return;
    let live = true;
    void supabaseBrowser().rpc('track_leaderboard', { p_track_id: trackId, p_scope: scope, p_limit: 10 })
      .then(({ data }) => { if (live) setRows((data ?? []) as Entry[]); });
    return () => { live = false; };
  }, [trackId, scope, user]);
  if (!user || user.is_anonymous || rows === null) return null;
  return (
    <section aria-label="Top singers" className="mb-10 max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold"><Trophy className="text-gold-400" size={22} aria-hidden /> Top singers</h2>
        <div className="flex gap-1 text-xs">
          {(['global', 'friends'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
              className={`rounded-full px-3 py-1 font-bold ${scope === s ? 'bg-ink-50 text-ink-950' : 'bg-ink-800 text-ink-300'}`}>
              {s === 'global' ? 'Everyone' : 'Friends'}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-300">No scores yet. Sing it on Stage and take the top spot.</p>
      ) : (
        <ol className="divide-y divide-ink-800 rounded-xl bg-ink-850">
          {rows.map((r) => (
            <li key={r.user_id} className={`flex items-center gap-3 px-4 py-2.5 ${r.user_id === user.id ? 'bg-ink-800' : ''}`}>
              <span className="w-6 text-right font-display font-bold tabular-nums text-ink-300">{r.rank}</span>
              <Avatar name={r.display_name} url={r.avatar_url} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.display_name}{r.user_id === user.id ? ' (you)' : ''}</span>
              {r.key_shift !== 0 && <span className="text-xs text-ink-500">key {r.key_shift > 0 ? '+' : ''}{r.key_shift}</span>}
              <span className="w-8 text-center text-xs font-bold text-ink-300">{r.grade}</span>
              <span className="w-10 text-right font-display text-lg font-bold tabular-nums">{r.score}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
