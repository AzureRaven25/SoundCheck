'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Award, Crown, Flame, Lock, Mic, Moon, Music2, PartyPopper, Repeat, Star, ThumbsUp, Timer, Users } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { SignInGate } from '@/components/social/SignInGate';
import { ProgressPanel } from '@/components/social/ProgressPanel';

interface Badge { id: string; title: string; description: string; icon: string; tier: 'bronze' | 'silver' | 'gold' | 'platinum'; earned_at: string | null }

// achievements.icon is a platform-neutral symbol name; this maps it to the web icon set
const ICONS: Record<string, typeof Award> = {
  mic: Mic, repeat: Repeat, star: Star, thumbsup: ThumbsUp, flame: Flame, crown: Crown, tuningfork: Music2,
  metronome: Timer, transpose: Music2, party: PartyPopper, people: Users, moon: Moon,
};
const TIER = { bronze: 'from-[#c98a5a] to-[#7a4a2a]', silver: 'from-ink-50 to-ink-500', gold: 'from-gold-400 to-pink-500', platinum: 'from-cyan-400 to-violet-500' };

function Badges() {
  const [badges, setBadges] = useState<Badge[] | null>(null);
  useEffect(() => { void supabaseBrowser().rpc('my_achievements').then(({ data }) => setBadges((data as Badge[] | null) ?? [])); }, []);
  const earned = badges?.filter((b) => b.earned_at).length ?? 0;
  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Achievements</h1>
      <p className="mt-1 mb-6 text-ink-300">{badges ? `${earned} of ${badges.length} earned` : 'Loading…'}</p>
      <ProgressPanel />
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {badges?.map((b) => {
          const Icon = ICONS[b.icon] ?? Award;
          return (
            <li key={b.id} className={clsx('flex items-center gap-4 rounded-2xl bg-ink-900 p-4 ring-1', b.earned_at ? 'ring-ink-700' : 'opacity-50 ring-transparent')}>
              <span className={clsx('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-ink-950', b.earned_at ? TIER[b.tier] : 'from-ink-700 to-ink-800 text-ink-300')}>
                {b.earned_at ? <Icon size={26} /> : <Lock size={22} />}
              </span>
              <div className="min-w-0">
                <p className="font-bold">{b.title} <span className="ml-1 text-xs font-normal capitalize text-ink-500">{b.tier}</span></p>
                <p className="text-sm text-ink-300">{b.description}</p>
                {b.earned_at && <p className="mt-0.5 text-xs text-ink-500">Earned {new Date(b.earned_at).toLocaleDateString()}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AchievementsPage() {
  return <SignInGate next="/achievements" what="your achievements" title="Achievements" why="Earn badges, level up and keep a singing streak. Log in to start collecting."><Badges /></SignInGate>;
}
