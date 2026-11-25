'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Mic2 } from 'lucide-react';
import { Artwork } from '@/components/ui/Artwork';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Row {
  id: string; started_at: string; sung_seconds: number; mode: string; party: boolean;
  tracks: { id: string; title: string; artist_credit: string; album_id: string | null } | null;
  performances: { score: number; grade: string } | null;
}

const ago = (iso: string) => {
  const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 86400_000);
  return days === 0 ? `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : days === 1 ? 'Yesterday' : d.toLocaleDateString();
};

/** Every song you sang on Stage (scored or not), newest first. */
export function SungHistory({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    void supabaseBrowser().from('sing_sessions')
      .select('id, started_at, sung_seconds, mode, party, tracks(id, title, artist_credit, album_id), performances(score, grade)')
      .eq('user_id', userId).order('started_at', { ascending: false }).limit(300)
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [userId]);
  if (!rows) return <p className="text-ink-300">Loading…</p>;
  if (!rows.length) return <p className="text-ink-300">Songs you sing on Stage show up here, with your scores. <Link href="/sing" className="underline">Start singing</Link>.</p>;
  return (
    <ol className="divide-y divide-ink-800" aria-label="Songs you sang">
      {rows.map((r) => r.tracks && (
        <li key={r.id} className="flex items-center gap-3 py-2.5">
          <div className="w-11 shrink-0"><Artwork src={null} albumId={r.tracks.album_id} title={r.tracks.title} sizes="44px" /></div>
          <div className="min-w-0 flex-1">
            <Link href={`/track/${r.tracks.id}`} className="block truncate font-bold hover:underline">{r.tracks.title}</Link>
            <p className="truncate text-sm text-ink-300">
              {r.tracks.artist_credit} · {ago(r.started_at)} · {r.sung_seconds >= 60 ? `${Math.round(r.sung_seconds / 60)} min` : `${r.sung_seconds} s`} sung{r.party ? ' · party' : ''}
            </p>
          </div>
          {r.performances ? (
            <span className="shrink-0 rounded-lg bg-ink-800 px-2.5 py-1 text-sm font-black tabular-nums" title="Score">{r.performances.score} <span className="text-pink-400">{r.performances.grade}</span></span>
          ) : <span className="shrink-0 text-xs text-ink-500">not scored</span>}
          <Link href={`/stage/${r.tracks.id}`} aria-label={`Sing ${r.tracks.title} again`} className="stage-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:scale-105">
            <Mic2 size={16} aria-hidden />
          </Link>
        </li>
      ))}
    </ol>
  );
}
