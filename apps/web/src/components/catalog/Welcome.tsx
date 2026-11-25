'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Mic2, Smartphone, Trophy, X } from 'lucide-react';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { TrackItem } from '@/lib/types';

const KEY = 'soundcheck.welcome.dismissed';

/** First-run welcome for a new account: how SoundCheck works and three songs to start with (until you've sung). */
export function Welcome({ picks }: { picks: TrackItem[] }) {
  const user = useUser();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!user || user.is_anonymous) return;
    try { if (localStorage.getItem(KEY)) return; } catch { /* storage blocked: still show */ }
    void supabaseBrowser().from('sing_sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      .then(({ count }) => setShow((count ?? 0) === 0));
  }, [user]);
  if (!show || !user) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setShow(false); };
  const name = (user.user_metadata?.display_name as string | undefined) ?? 'there';
  return (
    <section aria-label="Welcome" className="relative mb-8 rounded-2xl bg-ink-850 p-5 ring-1 ring-pink-500/30 md:p-6">
      <button type="button" onClick={dismiss} aria-label="Dismiss welcome" className="absolute right-3 top-3 rounded-full p-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-50"><X size={18} /></button>
      <h2 className="font-display text-2xl font-extrabold tracking-tight">Welcome, {name}! Here’s how it works</h2>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {[
          [Mic2, 'Pick a song', 'Any song: we line up the karaoke video and lyrics in time with the music.'],
          [Smartphone, 'Grab a mic', 'Use this device’s mic, or open a party and everyone joins with their phone.'],
          [Trophy, 'Get scored', 'Pitch, timing and expression, like a real karaoke box. Climb the leaderboards.'],
        ].map(([Icon, title, text], i) => {
          const I = Icon as typeof Mic2;
          return (
            <li key={i} className="flex gap-3 rounded-xl bg-ink-900 p-3">
              <span className="stage-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"><I size={18} aria-hidden /></span>
              <span><b className="block text-sm">{i + 1}. {title as string}</b><span className="text-sm text-ink-300">{text as string}</span></span>
            </li>
          );
        })}
      </ol>
      {picks.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold text-ink-300">Try one:</span>
          {picks.map((t) => (
            <Link key={t.id} prefetch={false} href={`/stage/${t.id}`} className="flex items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1.5 font-bold hover:bg-ink-700">
              <Mic2 size={14} className="text-pink-400" aria-hidden /> {t.title} <span className="font-normal text-ink-300">· {t.artist_credit}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
