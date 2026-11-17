'use client';
import { useEffect, useState } from 'react';
import { Server, Trash2 } from 'lucide-react';
import { connectServer, loadServers, removeServer, type ServerConfig, type ServerKind } from '@/lib/personal/servers';

/** Settings: connect your own Navidrome / Subsonic or Jellyfin server. Credentials stay on this device. */
export function ServerConnections() {
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [kind, setKind] = useState<ServerKind>('subsonic');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const sync = () => setServers(loadServers());
    sync();
    window.addEventListener('soundcheck-servers', sync);
    return () => window.removeEventListener('soundcheck-servers', sync);
  }, []);

  // not a <form>: this section sits inside the Settings page's own form
  async function connect() {
    if (!url.trim() || !username.trim() || !password) { setMsg({ ok: false, text: 'Enter the server address, username and password.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const s = await connectServer(kind, url, username, password);
      setMsg({ ok: true, text: `Connected to ${s.name}. Its songs now appear in search and play in full.` });
      setPassword(''); setUrl(''); setUsername('');
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Couldn’t connect.' });
    }
    setBusy(false);
  }

  const field = 'w-full rounded-lg bg-ink-850 px-3 py-2 ring-1 ring-ink-700 focus:outline-none focus:ring-pink-500';
  return (
    <section className="space-y-4" aria-label="Your music server">
      <div>
        <h2 className="text-lg font-bold">Your music server</h2>
        <p className="text-sm text-ink-300">
          Play your own library in full and make any of your songs karaoke-ready. Works with Navidrome, Airsonic, Gonic
          and other Subsonic servers, and with Jellyfin. Your password isn’t stored; this device keeps a sign-in token.
        </p>
      </div>
      {servers.length > 0 && (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg bg-ink-850 p-3">
              <Server size={18} className="text-cyan-400" />
              <span className="min-w-0 flex-1 truncate text-sm"><b>{s.name}</b> · {s.username} · {s.url}</span>
              <button type="button" aria-label={`Disconnect ${s.name}`} onClick={() => removeServer(s.id)} className="rounded-full p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-50"><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      <div role="group" aria-label="Connect a server" className="grid gap-3 sm:grid-cols-2"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void connect(); } }}>
        <label className="text-sm sm:col-span-2">Server type
          <select value={kind} onChange={(e) => setKind(e.target.value as ServerKind)} className={`${field} mt-1`}>
            <option value="subsonic">Navidrome / Subsonic</option>
            <option value="jellyfin">Jellyfin</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">Server address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://music.example.com" className={`${field} mt-1`} />
        </label>
        <label className="text-sm">Server username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className={`${field} mt-1`} />
        </label>
        <label className="text-sm">Server password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={`${field} mt-1`} />
        </label>
        <div className="sm:col-span-2">
          <button type="button" onClick={() => void connect()} disabled={busy} className="rounded-full bg-ink-50 px-5 py-2 text-sm font-bold text-ink-950 disabled:opacity-50">{busy ? 'Connecting…' : 'Connect server'}</button>
          {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? 'text-success-400' : 'text-danger-400'}`}>{msg.text}</p>}
        </div>
      </div>
    </section>
  );
}
