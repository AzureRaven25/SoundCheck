'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Check, Link2, Mic2, Search, UserMinus, UserPlus, X } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useUser } from '@/lib/hooks/useUser';
import { Avatar, SignInGate } from '@/components/social/SignInGate';

interface Person { id: string; display_name: string; username: string | null; avatar_url: string | null; relationship: 'friends' | 'requested' | 'incoming' | 'none' }
interface Friend { id: string; display_name: string; username: string | null; avatar_url: string | null; status: 'pending' | 'accepted'; direction: 'incoming' | 'outgoing'; songs_sung: number; best_score: number | null }

interface Activity { user_id: string; display_name: string; avatar_url: string | null; track_id: string; title: string; artist_credit: string; score: number; grade: string; performed_at: string }

function Friends() {
  const user = useUser();
  const inviteId = useSearchParams().get('invite');
  const [inviter, setInviter] = useState<{ id: string; display_name: string; avatar_url: string | null } | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!inviteId || !/^[0-9a-f-]{36}$/.test(inviteId)) return;
    void supabaseBrowser().rpc('invite_profile', { p_user_id: inviteId }).then(({ data }) => setInviter(((data as typeof inviter[]) ?? [])[0] ?? null));
  }, [inviteId]);
  useEffect(() => { void supabaseBrowser().rpc('friends_activity', { p_limit: 20 }).then(({ data }) => setActivity((data as Activity[] | null) ?? [])); }, []);
  const inviteUrl = typeof window !== 'undefined' && user ? `${window.location.origin}/friends?invite=${user.id}` : '';
  async function shareInvite() {
    try {
      if (navigator.share) { await navigator.share({ title: 'SoundCheck', text: 'Add me on SoundCheck and let’s sing!', url: inviteUrl }); return; }
    } catch { /* closed the sheet: copy instead */ }
    await navigator.clipboard?.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc('my_friends');
    setFriends((data as Friend[] | null) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (q.trim().length < 2) { setPeople([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser().rpc('search_people', { p_query: q.trim() });
      setPeople((data as Person[] | null) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    const { error: e } = await fn();
    if (e) setError(e.message);
    await load();
    if (q.trim().length >= 2) {
      const { data } = await supabaseBrowser().rpc('search_people', { p_query: q.trim() });
      setPeople((data as Person[] | null) ?? []);
    }
  }
  const sb = supabaseBrowser();
  const add = (id: string) => act(() => sb.from('friendships').insert({ friend_id: id }));
  const accept = (id: string) => act(() => sb.from('friendships').update({ status: 'accepted' }).eq('user_id', id).eq('friend_id', user!.id));
  const remove = (id: string) => act(() => sb.from('friendships').delete().or(`and(user_id.eq.${id},friend_id.eq.${user!.id}),and(user_id.eq.${user!.id},friend_id.eq.${id})`));

  const incoming = friends?.filter((f) => f.status === 'pending' && f.direction === 'incoming') ?? [];
  const outgoing = friends?.filter((f) => f.status === 'pending' && f.direction === 'outgoing') ?? [];
  const accepted = friends?.filter((f) => f.status === 'accepted') ?? [];
  const btn = 'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold';

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-6 md:p-8">
      <header>
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Friends</h1>
        <p className="mt-1 text-ink-300">Sing with friends, then compare scores on the friends leaderboard.</p>
      </header>

      {inviter && inviter.id !== user?.id && (() => {
        const rel = friends?.find((f) => f.id === inviter.id);
        return (
          <section aria-label="Invitation" className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-850 p-4 ring-1 ring-pink-500/40">
            <Avatar name={inviter.display_name} url={inviter.avatar_url} size={48} />
            <p className="min-w-0 flex-1"><b>{inviter.display_name}</b> invited you to be friends on SoundCheck.</p>
            {rel?.status === 'accepted' ? <span className="text-sm text-success-400">You’re friends</span>
              : rel?.direction === 'incoming' ? <button type="button" className={`${btn} bg-pink-500 text-ink-950`} onClick={() => void accept(inviter.id)}><Check size={14} /> Accept</button>
              : rel ? <span className="text-sm text-ink-300">Request sent</span>
              : <button type="button" className={`${btn} bg-ink-50 text-ink-950`} onClick={() => void add(inviter.id)}><UserPlus size={14} /> Add friend</button>}
          </section>
        );
      })()}

      <section aria-label="Invite friends" className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 p-4">
        <Link2 className="text-pink-400" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-ink-300">Send friends your invite link: they can add you in one tap.</p>
        <button type="button" onClick={() => void shareInvite()} className={`${btn} bg-ink-50 text-ink-950`}>{copied ? 'Link copied!' : 'Share invite link'}</button>
      </section>

      <section aria-label="Find people">
        <label className="flex items-center gap-3 rounded-full bg-ink-850 px-4 py-3 ring-1 ring-ink-700 focus-within:ring-pink-500">
          <Search size={18} className="text-ink-300" />
          <span className="sr-only">Find people</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find people by name or username" className="w-full bg-transparent outline-none" />
        </label>
        {people.length > 0 && (
          <ul className="mt-3 divide-y divide-ink-800 rounded-xl bg-ink-900">
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <Avatar name={p.display_name} url={p.avatar_url} />
                <div className="min-w-0 flex-1"><p className="truncate font-bold">{p.display_name}</p>{p.username && <p className="text-xs text-ink-500">@{p.username}</p>}</div>
                {p.relationship === 'none' && <button type="button" className={`${btn} bg-ink-50 text-ink-950`} onClick={() => void add(p.id)}><UserPlus size={14} /> Add</button>}
                {p.relationship === 'incoming' && <button type="button" className={`${btn} bg-pink-500 text-ink-950`} onClick={() => void accept(p.id)}><Check size={14} /> Accept</button>}
                {p.relationship === 'requested' && <span className="text-xs text-ink-300">Request sent</span>}
                {p.relationship === 'friends' && <span className="text-xs text-success-400">Friends</span>}
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && people.length === 0 && <p className="mt-3 px-2 text-sm text-ink-500">No one found.</p>}
      </section>

      {error && <p role="alert" className="text-danger-400">{error}</p>}

      {incoming.length > 0 && (
        <section aria-label="Friend requests">
          <h2 className="mb-3 text-lg font-bold">Requests</h2>
          <ul className="space-y-2">
            {incoming.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-xl bg-ink-900 p-3">
                <Avatar name={f.display_name} url={f.avatar_url} />
                <p className="flex-1 font-bold">{f.display_name}</p>
                <button type="button" className={`${btn} bg-pink-500 text-ink-950`} onClick={() => void accept(f.id)}><Check size={14} /> Accept</button>
                <button type="button" aria-label={`Decline ${f.display_name}`} className={`${btn} bg-ink-800`} onClick={() => void remove(f.id)}><X size={14} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activity && activity.length > 0 && (
        <section aria-label="Friends' recent songs">
          <h2 className="mb-3 text-lg font-bold">Your friends sang</h2>
          <ul className="divide-y divide-ink-800 rounded-xl bg-ink-900">
            {activity.map((a) => (
              <li key={`${a.user_id}-${a.performed_at}`} className="flex items-center gap-3 p-3">
                <Avatar name={a.display_name} url={a.avatar_url} size={36} />
                <p className="min-w-0 flex-1 truncate text-sm"><b>{a.display_name}</b> sang <Link prefetch={false} href={`/track/${a.track_id}`} className="font-bold hover:underline">{a.title}</Link> <span className="text-ink-300">· {a.artist_credit}</span></p>
                <span className="shrink-0 rounded-lg bg-ink-800 px-2 py-0.5 text-sm font-black tabular-nums">{a.score} <span className="text-pink-400">{a.grade}</span></span>
                <Link prefetch={false} href={`/stage/${a.track_id}`} aria-label={`Sing ${a.title} too`} className="stage-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"><Mic2 size={14} aria-hidden /></Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Your friends">
        <h2 className="mb-3 text-lg font-bold">Your friends</h2>
        {friends === null ? <p className="text-ink-500">Loading…</p> : accepted.length === 0 ? (
          <p className="text-ink-500">No friends yet. Find people above.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {accepted.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-xl bg-ink-900 p-4">
                <Avatar name={f.display_name} url={f.avatar_url} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{f.display_name}</p>
                  <p className="text-xs text-ink-300">{f.songs_sung} songs · best {f.best_score ?? '—'}</p>
                </div>
                <button type="button" aria-label={`Remove ${f.display_name}`} className="rounded-full p-2 text-ink-500 hover:bg-ink-800 hover:text-ink-50" onClick={() => void remove(f.id)}><UserMinus size={16} /></button>
              </li>
            ))}
          </ul>
        )}
        {outgoing.length > 0 && <p className="mt-4 text-sm text-ink-500">Waiting on: {outgoing.map((f) => f.display_name).join(', ')}</p>}
      </section>
    </div>
  );
}

function FriendsGate() {
  const invite = useSearchParams().get('invite');
  const next = invite ? `/friends?invite=${invite}` : '/friends';
  return <SignInGate next={next} what="your friends" title="Friends" why={invite ? 'Someone invited you to be friends on SoundCheck. Log in or create a free account to accept.' : 'Add friends to compare scores and see what they’re singing. Log in to find them.'}><Friends /></SignInGate>;
}

export default function FriendsPage() {
  return <Suspense><FriendsGate /></Suspense>;
}
