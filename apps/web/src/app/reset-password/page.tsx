'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/** Landing page from the reset email (after /auth/callback signed you in with the link): choose a new password. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    void supabaseBrowser().auth.getUser().then(({ data: { user } }) => setReady(!!user && !user.is_anonymous));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true); setError(null);
    const { error: err } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(/same|different/i.test(err.message) ? 'Pick a password you haven’t used for this account.' : err.message);
    setDone(true);
    setTimeout(() => { router.push('/'); router.refresh(); }, 1500);
  }
  const input = 'w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-3 text-sm focus:border-ink-50 focus:outline-none';
  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-6 text-center font-display text-3xl font-bold">Choose a new password</h1>
      {ready === null ? <p className="text-center text-ink-300">Checking your link…</p>
        : !ready ? (
          <div className="text-center">
            <p className="text-ink-300">This reset link has expired or was already used.</p>
            <Link href="/forgot-password" className="mt-6 inline-block rounded-full bg-ink-50 px-6 py-2.5 font-bold text-ink-950">Send a new link</Link>
          </div>
        ) : done ? (
          <p role="status" className="text-center text-success-400">Password updated. You’re logged in.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">New password</span>
              <input className={input} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
              <span className="mt-1 block text-xs text-ink-500">At least 8 characters.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Confirm new password</span>
              <input className={input} type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </label>
            {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-full bg-pink-500 py-3 font-bold text-ink-950 disabled:opacity-60">{busy ? 'Saving…' : 'Save new password'}</button>
          </form>
        )}
    </div>
  );
}
