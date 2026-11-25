'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/** Email + password sign-in / sign-up. OAuth providers (Apple, Google) plug in here once configured. */
export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    if (mode === 'login') {
      const { error: err } = await sb.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (err) return setError(/invalid login/i.test(err.message) ? 'Wrong email or password.' : err.message);
      router.push(safeNext);
      router.refresh();
      return;
    }
    const { data, error: err } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name.trim() || undefined },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });
    setBusy(false);
    if (err) return setError(err.message);
    if (data.session) {
      router.push(safeNext);
      router.refresh();
    } else {
      setNotice(`Check ${email} for a confirmation link to finish signing up.`);
    }
  }

  const input = 'w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-3 text-sm placeholder:text-ink-500 focus:border-ink-50 focus:outline-none';
  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-8 text-center font-display text-3xl font-bold">
        {mode === 'login' ? 'Log in to SoundCheck' : 'Sign up for SoundCheck'}
      </h1>
      <form onSubmit={submit} className="space-y-4" noValidate={false}>
        {mode === 'signup' && (
          <label className="block">
            <span className="mb-1 block text-sm font-bold">Display name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" placeholder="What should we call you?" />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-bold">Email</span>
          <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold">Password</span>
          <input
            className={input} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'signup' && <span className="mt-1 block text-xs text-ink-500">At least 8 characters.</span>}
        </label>
        {mode === 'login' && (
          <p className="-mt-2 text-right text-sm"><Link href="/forgot-password" className="text-ink-300 underline hover:text-ink-50">Forgot password?</Link></p>
        )}
        {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
        {notice && <p role="status" className="text-sm text-success-400">{notice}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-pink-500 py-3 font-bold text-ink-950 transition-transform hover:scale-[1.02] disabled:opacity-60">
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-300">
        {mode === 'login' ? (
          <>Don&apos;t have an account? <Link href={`/signup?next=${encodeURIComponent(safeNext)}`} className="font-bold text-ink-50 underline">Sign up</Link></>
        ) : (
          <>Already have an account? <Link href={`/login?next=${encodeURIComponent(safeNext)}`} className="font-bold text-ink-50 underline">Log in</Link></>
        )}
      </p>
    </div>
  );
}
