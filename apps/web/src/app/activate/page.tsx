'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CheckCircle2, Tv } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { SignInGate } from '@/components/social/SignInGate';

const NAMES: Record<string, string> = { tvos: 'Apple TV', firetv: 'Fire TV', web: 'browser', ios: 'iPhone', android: 'Android phone' };

/** Phones approve a TV sign-in here: the TV shows a code (and a QR code that opens this page with it). */
function Activate() {
  const params = useSearchParams();
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clean = code.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6);

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data, error: err } = await supabaseBrowser().functions.invoke<{ ok?: boolean; platform?: string; error?: string }>('device-auth', {
      body: { action: 'approve', user_code: clean },
    });
    setBusy(false);
    if (err || !data?.ok) {
      const ctx = (err as { context?: Response } | null)?.context;
      const msg = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : data?.error;
      setError(msg ?? 'That code didn’t work. Check the TV and try again.');
      return;
    }
    setDone(NAMES[data.platform ?? ''] ?? 'TV');
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <CheckCircle2 size={56} className="mx-auto text-success-400" />
        <h1 className="mt-4 font-display text-3xl font-extrabold">Your {done} is signed in</h1>
        <p className="mt-2 text-ink-300">You can put your phone away. Have fun on stage!</p>
      </div>
    );
  }
  return (
    <form onSubmit={approve} className="mx-auto flex max-w-sm flex-col items-center gap-5 p-8 text-center">
      <Tv size={44} className="text-pink-400" />
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Sign in on your TV</h1>
      <p className="text-ink-300">Enter the code shown on the TV. Only approve a code from a TV you’re using right now.</p>
      <label htmlFor="tvcode" className="sr-only">TV code</label>
      <input id="tvcode" value={clean} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off" maxLength={6} placeholder="ABC234"
        className="w-full rounded-2xl border-2 border-ink-700 bg-ink-850 py-4 text-center font-display text-4xl font-bold tracking-[0.4em] placeholder:text-ink-700 focus:border-pink-500 focus:outline-none" />
      <button type="submit" disabled={clean.length !== 6 || busy} className="stage-gradient w-full rounded-full py-4 text-lg font-bold disabled:opacity-40">
        {busy ? 'Signing in…' : 'Approve'}
      </button>
      {error && <p role="alert" className="text-danger-400">{error}</p>}
    </form>
  );
}

function ActivateRoute() {
  const code = useSearchParams().get('code') ?? '';
  return <SignInGate next={`/activate${code ? `?code=${code}` : ''}`} what="this page" title="Sign in on your TV" why="Your TV shows a code to link it to your account. Log in here first, then enter the code."><Activate /></SignInGate>;
}

export default function ActivatePage() {
  return <Suspense><ActivateRoute /></Suspense>;
}
