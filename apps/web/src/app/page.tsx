import Link from 'next/link';
import { Mic2, PartyPopper, Search, Upload } from 'lucide-react';
import { Shelf, TrackCard } from '@/components/catalog/Cards';
import { RecentlyPlayed } from '@/components/catalog/RecentlyPlayed';
import { getFullLengthTracks, getPopularTracks, getReadyToSing } from '@/lib/catalog';

export const revalidate = 300; // shelves refresh every 5 minutes; the page itself is served from cache

const GENRES = [
  { q: 'pop', label: 'Pop', from: '#ff3d9a', to: '#8b5cff' },
  { q: 'rock', label: 'Rock', from: '#ff5e5e', to: '#ff8a3d' },
  { q: 'acoustic', label: 'Acoustic', from: '#3ddc97', to: '#38e1ff' },
  { q: 'jazz', label: 'Jazz', from: '#ffc94d', to: '#ff8a3d' },
  { q: 'hip hop', label: 'Hip-hop', from: '#8b5cff', to: '#3d7bff' },
  { q: 'soul', label: 'Soul & R&B', from: '#ff8a3d', to: '#ff3d9a' },
  { q: 'electronic', label: 'Electronic', from: '#38e1ff', to: '#8b5cff' },
  { q: 'country', label: 'Country', from: '#ffc94d', to: '#3ddc97' },
  { q: 'classical', label: 'Classical', from: '#a7a2bd', to: '#3d7bff' },
  { q: 'ballad', label: 'Ballads', from: '#ff6bb3', to: '#ffc94d' },
];

const ACTIONS = [
  { href: '/sing', icon: PartyPopper, title: 'Start a party', text: 'TV on the big screen, phones as mics' },
  { href: '/search', icon: Search, title: 'Find a song', text: 'A million songs to look up' },
  { href: '/import', icon: Upload, title: 'Import your music', text: 'Folders, Bandcamp ZIPs, CD rips' },
];

export default async function HomePage() {
  const [ready, open, indie, classics, more] = await Promise.all([
    getReadyToSing(12),
    getFullLengthTracks(['openverse', 'internet_archive'], 12),
    getFullLengthTracks(['audius'], 12),
    getPopularTracks(12),
    getPopularTracks(12, 12),
  ]);
  return (
    <div className="pt-2">
      <section className="@container relative mb-8 overflow-hidden rounded-2xl">
        <div className="stage-gradient absolute inset-0" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(56,225,255,0.45),transparent_40%),radial-gradient(circle_at_10%_110%,rgba(255,201,77,0.35),transparent_45%)]" aria-hidden />
        <div className="relative grid gap-6 p-6 @2xl:grid-cols-[1.4fr_1fr] @2xl:items-end @2xl:p-10">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white/90">
              <Mic2 size={12} aria-hidden /> Karaoke night, anywhere
            </p>
            <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-white @2xl:text-5xl @5xl:text-6xl">
              Find the song.<br />Take the stage.
            </h1>
            <p className="mt-4 max-w-md text-base text-white/85">
              Thousands of full songs free to play, karaoke versions with the vocals pulled out, word-by-word lyrics, and
              your phone as the mic.
            </p>
          </div>
          <ul className="grid gap-2">
            {ACTIONS.map(({ href, icon: Icon, title, text }) => (
              <li key={href}>
                <Link href={href} className="group flex items-center gap-3 rounded-xl bg-black/25 p-3 backdrop-blur transition hover:bg-black/40">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-ink-950 transition group-hover:scale-105">
                    <Icon size={18} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-white">{title}</span>
                    <span className="block truncate text-xs text-white/75">{text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <nav aria-label="Genres" className="scrollbar-thin -mx-1 mb-8 flex gap-2 overflow-x-auto px-1 pb-1">
        {GENRES.map((g) => (
          <Link key={g.q} href={`/search?q=${encodeURIComponent(g.q)}`}
            className="shrink-0 rounded-full px-4 py-2 text-sm font-bold text-white shadow-lift transition hover:scale-105"
            style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}>
            {g.label}
          </Link>
        ))}
      </nav>

      <RecentlyPlayed />

      {ready.length > 0 && (
        <Shelf title="Ready to sing" subtitle="Karaoke versions anyone can sing right now">
          {ready.map((t) => <TrackCard key={t.id} t={t} list={ready} badge="karaoke" />)}
        </Shelf>
      )}
      {open.length > 0 && (
        <Shelf title="Full songs, free to play" subtitle="Openly licensed recordings from Jamendo, Wikimedia Commons and the Internet Archive">
          {open.map((t) => <TrackCard key={t.id} t={t} list={open} badge="full" />)}
        </Shelf>
      )}
      {indie.length > 0 && (
        <Shelf title="Fresh from independent artists" subtitle="Full tracks streamed from Audius">
          {indie.map((t) => <TrackCard key={t.id} t={t} list={indie} badge="full" />)}
        </Shelf>
      )}
      <Shelf title="Karaoke classics" subtitle="The songs everyone knows the words to">
        {classics.map((t) => <TrackCard key={t.id} t={t} list={classics} />)}
      </Shelf>
      <Shelf title="Crowd favorites">
        {more.map((t) => <TrackCard key={t.id} t={t} list={more} />)}
      </Shelf>
    </div>
  );
}
