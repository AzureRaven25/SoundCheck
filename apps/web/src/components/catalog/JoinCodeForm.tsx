'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Compact "enter the TV's code" form (the full-screen version lives at /join). */
export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const clean = code.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6);
  return (
    <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (clean.length === 6) router.push(`/join/${clean}`); }}>
      <label htmlFor="sing-code" className="sr-only">Party code</label>
      <input id="sing-code" value={clean} onChange={(e) => setCode(e.target.value)} placeholder="ABC234" autoComplete="off" maxLength={6}
        className="w-36 rounded-full border border-ink-700 bg-ink-900 px-4 py-2 text-center font-display font-bold tracking-[0.3em] placeholder:text-ink-700 focus:border-pink-500 focus:outline-none" />
      <button type="submit" disabled={clean.length !== 6} className="stage-gradient rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-40">Join</button>
    </form>
  );
}
