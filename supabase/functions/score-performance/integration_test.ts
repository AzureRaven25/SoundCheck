// Integration test against a running local stack + `supabase functions serve`.
// SB_TEST_URL, SB_TEST_SERVICE, SB_TEST_ANON from `supabase status -o env`. Skipped when unset.
import { assert, assertEquals } from 'jsr:@std/assert@1';

const URL_ = Deno.env.get('SB_TEST_URL'), SERVICE = Deno.env.get('SB_TEST_SERVICE'), ANON = Deno.env.get('SB_TEST_ANON');

Deno.test({ name: 'score-performance: solo + session + forgery checks', ignore: !URL_, fn: async () => {
  const admin = { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const mkUser = async (name: string) => {
    const email = `${name}-${crypto.randomUUID().slice(0, 8)}@soundcheck.test`;
    const u = await j(await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: admin, body: JSON.stringify({ email, password: 'correct-horse-battery', email_confirm: true }) }));
    const tok = await j(await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON!, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) }));
    return { id: u.id as string, h: { apikey: ANON!, Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' } };
  };
  const host = await mkUser('host'), singer = await mkUser('singer'), stranger = await mkUser('stranger');
  const trackId = crypto.randomUUID(), assetId = crypto.randomUUID();
  const notes = Array.from({ length: 12 }, (_, i) => ({ start: 1 + i * 0.5, end: 1.45 + i * 0.5, pitch: 60 + (i % 5), conf: 1 }));
  try {
    await fetch(`${URL_}/rest/v1/tracks`, { method: 'POST', headers: admin, body: JSON.stringify({ id: trackId, title: 'Score Test', artist_credit: 'Tester' }) });
    await fetch(`${URL_}/rest/v1/audio_assets`, { method: 'POST', headers: admin, body: JSON.stringify({ id: assetId, track_id: trackId, owner_id: host.id, kind: 'original', provider: 'upload', storage_path: `${host.id}/x.wav` }) });
    const ins = await fetch(`${URL_}/rest/v1/karaoke_analysis`, { method: 'POST', headers: admin, body: JSON.stringify({ track_id: trackId, source_asset_id: assetId, pipeline_version: 't', separation_model: 't', pitch_model: 't', notes, phrases: [] }) });
    assert(ins.ok, await ins.text());
    // perfect frames for the melody
    const frames: number[] = [];
    for (let t = 0; t < 8; t += 0.01) {
      const n = notes.find((x) => x.start <= t && t < x.end);
      frames.push(+t.toFixed(2), n ? 440 * 2 ** ((n.pitch - 69) / 12) : 0, n ? 0.95 : 0.1, n ? -15 : -60);
    }
    const call = (h: Record<string, string>, body: unknown) => fetch(`${URL_}/functions/v1/score-performance`, { method: 'POST', headers: h, body: JSON.stringify(body) });

    // solo
    const solo = await j(await call(host.h, { track_id: trackId, singers: [{ frames }] }));
    assertEquals(solo.results[0].grade, 'S', JSON.stringify(solo));
    assertEquals(solo.results[0].user_id, host.id);

    // session: host scores a member; a stranger cannot
    const s = await j(await fetch(`${URL_}/rest/v1/rpc/create_session`, { method: 'POST', headers: host.h, body: JSON.stringify({ p_platform: 'web' }) }));
    const jn = await j(await fetch(`${URL_}/rest/v1/rpc/join_session`, { method: 'POST', headers: singer.h, body: JSON.stringify({ p_code: s[0].pairing_code, p_display_name: 'Sam', p_platform: 'ios' }) }));
    const memberId = jn[0].member_id;
    const ok = await j(await call(host.h, { track_id: trackId, session_id: s[0].session_id, key_shift: 0, singers: [{ member_id: memberId, frames }] }));
    assertEquals(ok.results[0].user_id, singer.id);
    const forged = await call(stranger.h, { track_id: trackId, session_id: s[0].session_id, singers: [{ member_id: memberId, frames }] });
    assertEquals(forged.status, 403); await forged.body?.cancel();
    const anon = await call({ apikey: ANON!, 'Content-Type': 'application/json' }, { track_id: trackId, singers: [{ frames }] });
    assert(anon.status === 401 || anon.status === 403, String(anon.status)); await anon.body?.cancel();
    const bad = await call(host.h, { track_id: trackId, singers: [{ frames: [1, 2, 3] }] });
    assertEquals(bad.status, 400); await bad.body?.cancel();

    // the singer sees their performance + achievements
    const perf = await j(await fetch(`${URL_}/rest/v1/performances?track_id=eq.${trackId}&user_id=eq.${singer.id}`, { headers: singer.h }));
    assertEquals(perf.length, 1);
    const badges = await j(await fetch(`${URL_}/rest/v1/user_achievements?user_id=eq.${singer.id}&select=achievement_id`, { headers: singer.h }));
    assert(badges.some((b: { achievement_id: string }) => b.achievement_id === 'first_song'));
  } finally {
    await fetch(`${URL_}/rest/v1/tracks?id=eq.${trackId}`, { method: 'DELETE', headers: admin });
    for (const u of [host, singer, stranger]) await fetch(`${URL_}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: admin });
  }
} });
