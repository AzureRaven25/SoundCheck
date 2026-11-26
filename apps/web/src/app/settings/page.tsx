'use client';
import { ServerConnections } from '@/components/personal/ServerConnections';
import { ListeningTaste } from '@/components/personal/ListeningTaste';
import { useEffect, useState } from 'react';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Profile { display_name: string; username: string | null; bio: string | null; show_on_leaderboards: boolean }
interface Prefs { default_guide_vocal?: number; lyrics_size?: 'normal' | 'large' | 'huge'; autoplay?: boolean }

export default function SettingsPage() {
  const user = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from('profiles').select('display_name, username, bio, show_on_leaderboards').eq('id', user.id).single(),
      sb.from('user_preferences').select('prefs').eq('user_id', user.id).maybeSingle(),
    ]).then(([p, pr]) => {
      setProfile(p.data);
      setPrefs((pr.data?.prefs as Prefs) ?? {});
    });
  }, [user]);

  if (user === undefined || (user && !profile)) return <p className="pt-6 text-ink-300">Loading…</p>;
  if (!user || !profile) return <p className="pt-6 text-ink-300">Log in to change your settings.</p>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const sb = supabaseBrowser();
    const username = profile!.username?.trim().toLowerCase() || null;
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      sb.from('profiles').update({
        display_name: profile!.display_name.trim() || 'Singer', username, bio: profile!.bio?.trim() || null,
        show_on_leaderboards: profile!.show_on_leaderboards,
      }).eq('id', user!.id),
      sb.from('user_preferences').update({ prefs: prefs as never }).eq('user_id', user!.id),
    ]);
    const err = e1 ?? e2;
    if (err) setError(err.code === '23505' ? 'That username is taken.' : err.code === '23514' ? 'Usernames are 3–24 lowercase letters, numbers or _.' : err.message);
    else setStatus('Saved');
  }

  const field = 'w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm focus:border-ink-50 focus:outline-none';
  return (
    <form onSubmit={save} className="max-w-xl space-y-8 pt-4">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Settings</h1>
      <section className="space-y-4">
        <h2 className="text-lg font-bold">Profile</h2>
        <label className="block"><span className="mb-1 block text-sm font-bold">Display name</span>
          <input className={field} value={profile.display_name} maxLength={40} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
        </label>
        <label className="block"><span className="mb-1 block text-sm font-bold">Username</span>
          <input className={field} value={profile.username ?? ''} maxLength={24} pattern="[a-z0-9_]{3,24}" onChange={(e) => setProfile({ ...profile, username: e.target.value })} placeholder="3–24 lowercase letters, numbers or _" />
        </label>
        <label className="block"><span className="mb-1 block text-sm font-bold">Bio</span>
          <textarea className={field} rows={3} maxLength={300} value={profile.bio ?? ''} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={profile.show_on_leaderboards} onChange={(e) => setProfile({ ...profile, show_on_leaderboards: e.target.checked })} />
          Show my scores on public leaderboards
        </label>
      </section>
      <ListeningTaste userId={user.id} />
      <details className="group rounded-xl bg-ink-900 p-4">
        <summary className="cursor-pointer font-bold">Advanced: play music from your own server <span className="text-sm font-normal text-ink-300">(Navidrome, Jellyfin, Subsonic)</span></summary>
        <div className="mt-4"><ServerConnections /></div>
      </details>
      <section className="space-y-4">
        <h2 className="text-lg font-bold">SoundCheck Stage</h2>
        <label className="block"><span className="mb-1 block text-sm font-bold">Default guide vocal: {Math.round((prefs.default_guide_vocal ?? 0) * 100)}%</span>
          <input type="range" min={0} max={1} step={0.1} value={prefs.default_guide_vocal ?? 0} onChange={(e) => setPrefs({ ...prefs, default_guide_vocal: Number(e.target.value) })} className="w-full" />
        </label>
        <label className="block"><span className="mb-1 block text-sm font-bold">Lyrics size</span>
          <select className={field} value={prefs.lyrics_size ?? 'large'} onChange={(e) => setPrefs({ ...prefs, lyrics_size: e.target.value as Prefs['lyrics_size'] })}>
            <option value="normal">Normal</option><option value="large">Large</option><option value="huge">Huge (TV)</option>
          </select>
        </label>
      </section>
      {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
      {status && <p role="status" className="text-sm text-success-400">{status}</p>}
      <button type="submit" className="rounded-full bg-pink-500 px-8 py-3 font-bold text-ink-950 hover:scale-105">Save</button>
    </form>
  );
}
