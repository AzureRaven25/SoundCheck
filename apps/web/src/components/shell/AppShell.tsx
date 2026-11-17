'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useLibrary } from '@/lib/hooks/useLibrary';
import { useUser } from '@/lib/hooks/useUser';
import { PlayerHost } from '@/player/PlayerHost';
import { PlayerBar } from './PlayerBar';
import { QueuePanel } from './QueuePanel';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** Persistent app frame: sidebar, scrolling content, queue drawer, and the always-on player. */
export function AppShell({ children }: { children: ReactNode }) {
  const user = useUser();
  const loadLibrary = useLibrary((s) => s.load);
  useEffect(() => {
    if (user !== undefined) void loadLibrary(user?.id ?? null);
  }, [user, loadLibrary]);

  // SoundCheck Stage and the phone mic page are full-screen experiences without the app chrome.
  const path = usePathname();
  if (path.startsWith('/stage') || path.startsWith('/join')) {
    return <div className="h-full overflow-hidden bg-ink-950">{children}</div>;
  }

  return (
    <div className="grid h-full grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-2 p-2">
      <Sidebar user={user ?? null} />
      <div className="relative flex min-w-0 overflow-hidden rounded-xl bg-ink-900">
        <main id="main" className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
          <TopBar user={user ?? null} />
          <div className="px-4 pb-16 md:px-8">{children}</div>
        </main>
        <QueuePanel />
      </div>
      <div className="col-span-2">
        <PlayerBar signedIn={!!user} />
      </div>
      <PlayerHost />
    </div>
  );
}
