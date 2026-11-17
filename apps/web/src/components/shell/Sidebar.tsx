'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import clsx from 'clsx';
import { Award, Home, Library, ListMusic, Plus, Search, Trophy, Upload, Users } from 'lucide-react';
import { useLibrary } from '@/lib/hooks/useLibrary';

const NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/library', label: 'Your Library', icon: Library },
  { href: '/import', label: 'Import music', icon: Upload },
  { href: '/leaderboards', label: 'Leaderboards', icon: Trophy },
  { href: '/friends', label: 'Friends', icon: Users },
  { href: '/achievements', label: 'Achievements', icon: Award },
];

export function Sidebar({ user }: { user: User | null }) {
  const path = usePathname();
  const router = useRouter();
  const playlists = useLibrary((s) => s.playlists);
  const createPlaylist = useLibrary((s) => s.createPlaylist);

  return (
    <aside className="hidden w-64 flex-col gap-2 md:flex" aria-label="Primary">
      <nav className="rounded-xl bg-ink-900 p-4">
        <Link href="/" className="mb-5 flex items-center gap-2 px-2" aria-label="SoundCheck home">
          <span className="stage-gradient flex h-8 w-8 items-center justify-center rounded-full text-sm font-black">S</span>
          <span className="font-display text-xl font-bold tracking-tight">
            Sound<span className="text-pink-500">Check</span>
          </span>
        </Link>
        <ul className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? path === '/' : path.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex items-center gap-4 rounded-md px-2 py-2 text-sm font-bold transition-colors',
                    active ? 'text-ink-50' : 'text-ink-300 hover:text-ink-50',
                  )}
                >
                  <Icon size={22} strokeWidth={active ? 2.5 : 2} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl bg-ink-900 p-4" aria-label="Your playlists">
        <div className="mb-3 flex items-center justify-between px-2">
          <h2 className="text-sm font-bold text-ink-300">Playlists</h2>
          {user && (
            <button
              type="button"
              aria-label="Create playlist"
              className="rounded-full p-1 text-ink-300 hover:bg-ink-800 hover:text-ink-50"
              onClick={async () => {
                const id = await createPlaylist(`My Playlist #${playlists.length + 1}`);
                if (id) router.push(`/playlist/${id}`);
              }}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
        {!user ? (
          <div className="rounded-lg bg-ink-850 p-4">
            <p className="text-sm font-bold">Make it yours</p>
            <p className="mt-1 text-xs text-ink-300">Sign in to save favorites, build playlists and track your scores.</p>
            <Link href="/login" className="mt-3 inline-block rounded-full bg-ink-50 px-4 py-1.5 text-xs font-bold text-ink-950 hover:scale-105">
              Sign in
            </Link>
          </div>
        ) : playlists.length === 0 ? (
          <p className="px-2 text-xs text-ink-500">No playlists yet. Use + to create one.</p>
        ) : (
          <ul className="space-y-0.5">
            {playlists.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/playlist/${p.id}`}
                  className={clsx(
                    'flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-ink-800',
                    path === `/playlist/${p.id}` ? 'text-pink-400' : 'text-ink-300',
                  )}
                >
                  <ListMusic size={16} className="shrink-0" />
                  <span className="truncate">{p.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
