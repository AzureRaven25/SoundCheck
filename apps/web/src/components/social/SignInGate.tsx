'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useUser } from '@/lib/hooks/useUser';

/** Renders children only for signed-in (non-guest) users; otherwise a sign-in prompt. */
export function SignInGate({ next, what, children }: { next: string; what: string; children: ReactNode }) {
  const user = useUser();
  if (user === undefined) return <p className="flex items-center gap-2 p-8 text-ink-300"><Loader2 className="animate-spin" size={18} /> Loading…</p>;
  if (!user || user.is_anonymous) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="font-display text-2xl font-bold">Sign in to see {what}</p>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="mt-5 inline-block rounded-full bg-ink-50 px-6 py-2.5 font-bold text-ink-950">Sign in</Link>
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
