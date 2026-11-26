'use client';
/**
 * Host controls for a party, on the TV: the request queue (move up, play next, remove), each singer (mute,
 * remove), and "take turns" (one phone sings each song; the turn passes to the next singer every song).
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowUp, ChevronsUp, MicOff, Mic, UserMinus, X } from 'lucide-react';
import { PROTOCOL_VERSION } from '@soundcheck/contracts';
import { supabaseBrowser } from '@/lib/supabase/client';
import { queueChanged, type QueueItem } from '@/session/queue';
import type { useHostSession } from '@/session/useHostSession';

type Host = ReturnType<typeof useHostSession>;
const turnKey = (sid: string) => `soundcheck.turns.${sid}`;

interface Turns { on: boolean; index: number }
function readTurns(sid: string): Turns {
  try { return { on: false, index: 0, ...(JSON.parse(sessionStorage.getItem(turnKey(sid)) ?? '{}') as Partial<Turns>) }; } catch { return { on: false, index: 0 }; }
}

/**
 * `phase`: when a song starts with turns on, everyone but the singer whose turn it is gets muted; when results
 * come in, the turn passes on (kept per party in sessionStorage so it survives moving to the next song's page).
 */
export function PartyPanel({ host, items, reload, currentTrackId, phase }: {
  host: Host; items: QueueItem[]; reload: () => Promise<void>; currentTrackId: string; phase: string;
}) {
  const sid = host.session?.id ?? '';
  const [turns, setTurns] = useState<Turns>(() => (sid ? readTurns(sid) : { on: false, index: 0 }));
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (sid) setTurns(readTurns(sid)); }, [sid]);
  useEffect(() => { if (sid) try { sessionStorage.setItem(turnKey(sid), JSON.stringify(turns)); } catch { /* ignore */ } }, [sid, turns]);

  const singers = host.singers();
  const turnSinger = turns.on && singers.length ? singers[turns.index % singers.length] : null;
  const command = (memberId: string, c: 'mute' | 'unmute' | 'kick') => host.send({ type: 'host_command', v: PROTOCOL_VERSION, memberId, command: c });
  const setMute = (memberId: string, on: boolean) => {
    command(memberId, on ? 'mute' : 'unmute');
    setMuted((m) => { const n = new Set(m); if (on) n.add(memberId); else n.delete(memberId); return n; });
  };

  // take turns: at the start of a song, only the singer whose turn it is keeps a live mic; pass the turn after
  const last = useRef(phase);
  useEffect(() => {
    const prev = last.current;
    last.current = phase;
    if (!turns.on || !singers.length) return;
    if (phase === 'singing' && prev !== 'singing' && turnSinger) for (const s of singers) setMute(s.memberId, s.memberId !== turnSinger.memberId);
    if (phase === 'results' && prev !== 'results') setTurns((t) => ({ ...t, index: t.index + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const upcoming = items.filter((q) => q.status === 'queued' && q.track_id !== currentTrackId);
  const changed = async () => { await reload(); host.send(queueChanged); };
  const sb = supabaseBrowser();
  const move = async (i: number, to: 'up' | 'top') => {
    const it = upcoming[i]!;
    const pos = to === 'top' ? upcoming[0]!.queue_position - 1 : i > 1 ? (upcoming[i - 2]!.queue_position + upcoming[i - 1]!.queue_position) / 2 : upcoming[0]!.queue_position - 1;
    const { error: e } = await sb.from('session_queue').update({ position: pos }).eq('id', it.id);
    if (e) setError('Couldn’t reorder the queue.'); else await changed();
  };
  const remove = async (id: string) => {
    const { error: e } = await sb.from('session_queue').delete().eq('id', id);
    if (e) setError('Couldn’t remove that song.'); else await changed();
  };
  const removeSinger = async (memberId: string) => {
    const { error: e } = await sb.rpc('remove_session_member', { p_member_id: memberId });
    if (e) return setError('Couldn’t remove that singer.');
    command(memberId, 'kick');
  };

  if (!host.session) return null;
  return (
    <section aria-label="Party controls" className="mx-auto mt-4 grid w-full max-w-3xl gap-3 text-left text-sm md:grid-cols-2">
      <div className="rounded-xl bg-ink-850/80 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-300">Singers</p>
          <label className="flex items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={turns.on} onChange={(e) => setTurns((t) => ({ ...t, on: e.target.checked }))} /> Take turns
          </label>
        </div>
        {turnSinger && <p className="mb-2 rounded-lg bg-pink-500/15 px-2 py-1 text-xs font-bold text-pink-400" role="status">Next up to sing: {turnSinger.name}</p>}
        {singers.length === 0 ? <p className="text-ink-500">No phones yet.</p> : (
          <ul className="space-y-1" aria-label="Manage singers">
            {singers.map((s) => (
              <li key={s.memberId} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate font-bold">{s.name}</span>
                <button type="button" onClick={() => setMute(s.memberId, !muted.has(s.memberId))} aria-label={`${muted.has(s.memberId) ? 'Unmute' : 'Mute'} ${s.name}`}
                  className={clsx('rounded-full p-1.5', muted.has(s.memberId) ? 'bg-gold-400/20 text-gold-400' : 'bg-ink-800 text-ink-300 hover:text-ink-50')}>
                  {muted.has(s.memberId) ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
                <button type="button" onClick={() => void removeSinger(s.memberId)} aria-label={`Remove ${s.name} from the party`} className="rounded-full bg-ink-800 p-1.5 text-ink-300 hover:text-danger-400"><UserMinus size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-xl bg-ink-850/80 p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-300">Queue</p>
        {upcoming.length === 0 ? <p className="text-ink-500">Singers can request songs from their phones.</p> : (
          <ol className="space-y-1" aria-label="Manage queue">
            {upcoming.map((q, i) => (
              <li key={q.id} className="flex items-center gap-1.5">
                <span className="w-4 text-ink-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate"><b>{q.title}</b> <span className="text-ink-300">· {q.requester_name ?? q.artist_credit}</span></span>
                {i > 0 && <button type="button" onClick={() => void move(i, 'top')} aria-label={`Play ${q.title} next`} className="rounded-full bg-ink-800 p-1.5 text-ink-300 hover:text-ink-50"><ChevronsUp size={14} /></button>}
                {i > 1 && <button type="button" onClick={() => void move(i, 'up')} aria-label={`Move ${q.title} up`} className="rounded-full bg-ink-800 p-1.5 text-ink-300 hover:text-ink-50"><ArrowUp size={14} /></button>}
                <button type="button" onClick={() => void remove(q.id)} aria-label={`Remove ${q.title} from the queue`} className="rounded-full bg-ink-800 p-1.5 text-ink-300 hover:text-danger-400"><X size={14} /></button>
              </li>
            ))}
          </ol>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-danger-400 md:col-span-2">{error}</p>}
    </section>
  );
}
