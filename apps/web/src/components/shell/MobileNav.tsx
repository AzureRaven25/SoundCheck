'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Home, Library, Mic2, Search, Upload } from 'lucide-react';

const ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/sing', label: 'Sing', icon: Mic2 },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/import', label: 'Import', icon: Upload },
];

/** Bottom tab bar on phones (the sidebar is hidden below md). */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="mt-2 grid grid-cols-5 rounded-xl bg-ink-900 md:hidden">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? 'page' : undefined}
            className={clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-bold', active ? 'text-ink-50' : 'text-ink-500')}>
            {href === '/sing'
              ? <span className={clsx('stage-gradient -mt-1 flex size-8 items-center justify-center rounded-full text-white', active && 'ring-2 ring-white/60')}><Icon size={16} /></span>
              : <Icon size={20} strokeWidth={active ? 2.5 : 2} />}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
