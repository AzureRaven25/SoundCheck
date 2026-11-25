import type { Metadata } from 'next';
import Link from 'next/link';
import { MonitorPlay, Smartphone } from 'lucide-react';
import { MyKaraoke, SingRows } from '@/components/catalog/SingList';
import { JoinCodeForm } from '@/components/catalog/JoinCodeForm';
import { SurpriseMe } from '@/components/catalog/SurpriseMe';
import { HeroSearch } from '@/components/catalog/HeroSearch';
import { getReadyToSing } from '@/lib/catalog';

export const metadata: Metadata = { title: 'Sing' };
export const revalidate = 300;

export default async function SingPage() {
  const ready = await getReadyToSing(60);
  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Sing</h1>
        <SurpriseMe ids={ready.map((t) => t.id)} />
      </div>
      <p className="mt-2 max-w-2xl text-ink-300">
        Pick a song to open SoundCheck Stage. Put it on a TV or laptop for a party: everyone joins with their phone as the mic and
        gets scored, or sing solo with this device&apos;s microphone. Any song works: we find its karaoke video and line up the lyrics.
      </p>
      <HeroSearch />

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-ink-850 p-5">
          <MonitorPlay className="text-pink-400" aria-hidden />
          <h2 className="mt-3 font-display text-xl font-bold">Host a party</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-300">
            <li>Choose a song below on the screen everyone can see.</li>
            <li>Stage shows a 6-letter code; friends open <b className="text-ink-50">/join</b> on their phones.</li>
            <li>Add songs to the queue, sing, and see everyone&apos;s scores.</li>
          </ol>
        </div>
        <div className="rounded-2xl bg-ink-850 p-5">
          <Smartphone className="text-cyan-400" aria-hidden />
          <h2 className="mt-3 font-display text-xl font-bold">Join a party</h2>
          <p className="mt-2 text-sm text-ink-300">Type the code on the TV to use this phone as a mic.</p>
          <JoinCodeForm />
        </div>
      </div>

      <div className="mt-10"><MyKaraoke /></div>

      <section className="mb-10">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-2xl font-bold">Ready for everyone</h2>
          <Link href="/search" className="text-xs font-bold text-ink-300 hover:underline">Find more songs</Link>
        </div>
        {ready.length ? <SingRows tracks={ready} /> : (
          <p className="text-sm text-ink-300">Shared karaoke versions appear here as open-licensed songs are processed.</p>
        )}
      </section>
    </div>
  );
}
