'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Phones land here from "soundcheck.app/join": type the code shown on the TV. */
export default function JoinCodePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const clean = code.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6);
  return (
    <main className="flex h-full flex-col items-center justify-center gap-8 p-6 text-center">
      <div>
        <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-pink-400">SoundCheck Party</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">Join the stage</h1>
        <p className="mt-2 text-ink-300">Enter the 6-character code on the TV.</p>
      </div>
      <form className="w-full max-w-xs" onSubmit={(e) => { e.preventDefault(); if (clean.length === 6) router.push(`/join/${clean}`); }}>
        <label htmlFor="code" className="sr-only">Pairing code</label>
        <input
          id="code" value={clean} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off" autoCapitalize="characters"
          inputMode="text" maxLength={6} placeholder="ABC234"
          className="w-full rounded-2xl border-2 border-ink-700 bg-ink-850 py-4 text-center font-display text-4xl font-bold tracking-[0.4em] placeholder:text-ink-700 focus:border-pink-500 focus:outline-none"
        />
        <button type="submit" disabled={clean.length !== 6} className="stage-gradient mt-6 w-full rounded-full py-4 text-lg font-bold disabled:opacity-40">Join</button>
      </form>
    </main>
  );
}
