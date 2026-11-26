'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/**
 * Finishes email links in the browser: links in Supabase's older format carry the session after '#'
 * (#access_token=…&refresh_token=…&type=recovery), which the server never sees. Password resets go on to
 * "Choose a new password"; anything else to where the link was headed. Expired or used links get a way forward.
 */
function Confirm() {
  const router = useRouter();
  const params = useSearchParams();
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = params.get('next') ?? '/';
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const access = hash.get('access_token'), refresh = hash.get('refresh_token');
    const err = hash.get('error_description') ?? params.get('error');
    if (access && refresh) {
      void supabaseBrowser().auth.setSession({ access_token: access, refresh_token: refresh }).then(({ error }) => {
        if (error) return setProblem('This link has expired or was already used.');
        history.replaceState(null, '', window.location.pathname);   // don't leave tokens in the address bar
        router.replace(hash.get('type') === 'recovery' ? '/reset-password' : safeNext);
        router.refresh();
      });
      return;
    }
    setProblem(err && !/^expired$/.test(err) ? err.replace(/\+/g, ' ') : 'This link has expired or was already used.');
  }, [params, router]);
  if (!problem) return <p className="pt-16 text-center text-ink-300">Signing you in…</p>;
  return (
    <div className="mx-auto max-w-sm pt-16 text-center">
      <h1 className="font-display text-2xl font-bold">That link didn’t work</h1>
      <p className="mt-3 text-ink-300">{problem} Links from SoundCheck emails work once and expire after an hour.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/forgot-password" className="rounded-full bg-ink-50 px-5 py-2.5 text-sm font-bold text-ink-950">Send a new reset link</Link>
        <Link href="/login" className="rounded-full border border-ink-700 px-5 py-2.5 text-sm font-bold">Log in</Link>
      </div>
    </div>
  );
}

export default function AuthConfirmPage() {
  return <Suspense><Confirm /></Suspense>;
}
