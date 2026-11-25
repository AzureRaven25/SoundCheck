'use client';
import Link from 'next/link';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/** Ask for a password-reset email. Says the same thing whether or not the account exists (no account probing). */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback`,   // exactly as allow-listed; the callback spots recovery logins
    });
    setBusy(false);
    // rate limits are the only error worth showing; anything about the address itself stays private
    if (err && /rate|too many|seconds/i.test(err.message)) return setError('Too many requests. Wait a minute and try again.');
    setSent(true);
  }
  const input = 'w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-3 text-sm placeholder:text-ink-500 focus:border-ink-50 focus:outline-none';
  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-3 text-center font-display text-3xl font-bold">Reset your password</h1>
      {sent ? (
        <div className="text-center">
          <p role="status" className="text-ink-300">If there’s an account for <b className="text-ink-50">{email}</b>, a link to set a new password is on its way. It can take a minute; check spam too.</p>
          <Link href="/login" className="mt-6 inline-block font-bold underline">Back to log in</Link>
        </div>
      ) : (
        <>
          <p className="mb-6 text-center text-sm text-ink-300">Enter your account’s email and we’ll send you a link to choose a new password.</p>
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">Email</span>
              <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
            </label>
            {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-full bg-pink-500 py-3 font-bold text-ink-950 transition-transform hover:scale-[1.02] disabled:opacity-60">
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <p className="mt-8 text-center text-sm text-ink-300">Remembered it? <Link href="/login" className="font-bold text-ink-50 underline">Log in</Link></p>
        </>
      )}
    </div>
  );
}
