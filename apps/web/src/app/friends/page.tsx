'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, Search, UserMinus, UserPlus, X } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useUser } from '@/lib/hooks/useUser';
import { Avatar, SignInGate } from '@/components/social/SignInGate';

interface Person { id: string; display_name: string; username: string | null; avatar_url: string | null; relationship: 'friends' | 'requested' | 'incoming' | 'none' }
interface Friend { id: string; display_name: string; username: string | null; avatar_url: string | null; status: 'pending' | 'accepted'; direction: 'incoming' | 'outgoing'; songs_sung: number; best_score: number | null }

function Friends() {
  const user = useUser();
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

export default function FriendsPage() {
  return <SignInGate next="/friends" what="your friends" title="Friends" why="Add friends to compare scores and see what they’re singing. Log in to find them."><Friends /></SignInGate>;
}
