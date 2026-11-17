import { Shelf, TrackCard } from '@/components/catalog/Cards';
import { RecentlyPlayed } from '@/components/catalog/RecentlyPlayed';
import { getPopularTracks } from '@/lib/catalog';

export default async function HomePage() {
  const [classics, more] = await Promise.all([getPopularTracks(12), getPopularTracks(12, 12)]);
  return (
    <div className="pt-2">
      <section className="relative mb-10 overflow-hidden rounded-2xl p-8 md:p-12">
        <div className="stage-gradient absolute inset-0 opacity-90" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(56,225,255,0.35),transparent_45%)]" aria-hidden />
        <div className="relative max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-white/80">SoundCheck</p>
          <h1 className="mt-3 font-display text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            Find the song. Take the stage.
          </h1>
          <p className="mt-4 max-w-lg text-base text-white/85">
            Stream a million songs, then sing them with the vocals pulled out, synced lyrics, and your phone as the mic.
          </p>
        </div>
      </section>

      <RecentlyPlayed />

      <Shelf title="Karaoke classics">
        {classics.map((t) => <TrackCard key={t.id} t={t} list={classics} />)}
      </Shelf>
      <Shelf title="Crowd favorites">
        {more.map((t) => <TrackCard key={t.id} t={t} list={more} />)}
      </Shelf>
    </div>
  );
}
