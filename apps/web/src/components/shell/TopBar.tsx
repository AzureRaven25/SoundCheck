'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { ChevronLeft, ChevronRight, LogOut, Search, Settings, User as UserIcon } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';

function SearchBox() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (path === '/search') setQ(params.get('q') ?? '');
  }, [path, params]);

  return (
    <form
      role="search"
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-300" />
      <input
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.replace(`/search?q=${encodeURIComponent(v.trim())}`), 300);
        }}
        placeholder="What do you want to sing?"
        aria-label="Search songs and artists"
        className="w-full rounded-full border border-transparent bg-ink-800 py-2.5 pl-10 pr-4 text-sm placeholder:text-ink-500 hover:border-ink-700 focus:border-ink-50 focus:outline-none"
      />
    </form>
  );
}

export function TopBar({ user }: { user: User | null }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 bg-ink-900/85 px-4 py-3 backdrop-blur md:px-8">
      <div className="hidden gap-2 sm:flex">
        <button type="button" aria-label="Back" onClick={() => router.back()} className="rounded-full bg-ink-950/70 p-1.5 text-ink-300 hover:text-ink-50">
          <ChevronLeft size={20} />
        </button>
        <button type="button" aria-label="Forward" onClick={() => router.forward()} className="rounded-full bg-ink-950/70 p-1.5 text-ink-300 hover:text-ink-50">
          <ChevronRight size={20} />
        </button>
      </div>
      <Suspense fallback={<div className="h-10 w-full max-w-md rounded-full bg-ink-800" />}>
        <SearchBox />
      </Suspense>
      <div className="ml-auto">
        {user === null ? (
          <div className="flex items-center gap-2">
            <Link href="/signup" className="hidden whitespace-nowrap px-3 text-sm font-bold text-ink-300 hover:text-ink-50 lg:block">Sign up</Link>
            <Link href="/login" className="whitespace-nowrap rounded-full bg-ink-50 px-6 py-2.5 text-sm font-bold text-ink-950 hover:scale-105">Log in</Link>
          </div>
        ) : (
          <div className="relative">
            <button
              type="button"
              aria-label="Account menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-pink-500 font-bold text-ink-950"
            >
              {(user.user_metadata?.display_name ?? user.email ?? 'S').slice(0, 1).toUpperCase()}
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 mt-2 w-52 overflow-hidden rounded-md bg-ink-800 py-1 shadow-lift" onMouseLeave={() => setMenu(false)}>
                <p className="truncate px-3 py-2 text-xs text-ink-300">{user.email ?? 'Guest'}</p>
                <Link role="menuitem" href="/settings" onClick={() => setMenu(false)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ink-700">
                  <Settings size={16} /> Settings
                </Link>
                <Link role="menuitem" href="/library" onClick={() => setMenu(false)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ink-700">
                  <UserIcon size={16} /> Your library
                </Link>
                <button
                  role="menuitem"
                  type="button"
                  className="flex w-full items-center gap-2 border-t border-ink-700 px-3 py-2 text-left text-sm hover:bg-ink-700"
                  onClick={async () => {
                    await supabaseBrowser().auth.signOut({ scope: 'local' }); // this device only: your TV and phone stay signed in
                    setMenu(false);
                    router.push('/');
                    router.refresh();
                  }}
                >
                  <LogOut size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
