'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useUser } from '@/lib/hooks/useUser';

/** Renders children only for signed-in (non-guest) users; otherwise what the page is for and how to get in. */
export function SignInGate({ next, what, title, why, children }: { next: string; what: string; title?: string; why?: string; children: ReactNode }) {
  const user = useUser();
  if (user === undefined) return <p className="flex items-center gap-2 p-8 text-ink-300"><Loader2 className="animate-spin" size={18} /> Loading…</p>;
  if (!user || user.is_anonymous) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        {title && <h1 className="font-display text-3xl font-extrabold tracking-tight">{title}</h1>}
        <p className={title ? 'mt-3 text-ink-300' : 'font-display text-2xl font-bold'}>{why ?? `Log in to see ${what}.`}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="rounded-full bg-ink-50 px-6 py-2.5 font-bold text-ink-950">Log in</Link>
          <Link href={`/signup?next=${encodeURIComponent(next)}`} className="rounded-full border border-ink-700 px-6 py-2.5 font-bold hover:border-ink-300">Create a free account</Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className="stage-gradient inline-flex items-center justify-center rounded-full font-bold" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
