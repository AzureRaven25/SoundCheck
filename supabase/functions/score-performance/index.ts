/**
 * score-performance: compute and store official SoundCheck Scores (docs/SCORING.md).
 *
 * Called by the host at the end of a song with each singer's pitch frames (collected over the
 * session's Realtime channel), or by a solo singer for their own run. Scores are written with the
 * service role, so clients can't insert or alter performances (RLS has no client insert policy).
 *
 * Trust model: the caller must be the session host (or the singer, for solo). Members must belong
 * to the session. The host relays phone frames, so a malicious host could fabricate frames for their
 * own party; scores are therefore flagged with how they were captured, and global leaderboards can
 * later be restricted to verified captures.
 *
 * POST { track_id, session_id?, key_shift?, mode?: 'melody' | 'lyrics', singers: [{ member_id?, frames: number[], latency_ms?, noise_floor_db? }] }
 *
 * Party guests (phones that joined without logging in) also count together: their scores are averaged into one
 * combined guest performance on the host's account (returned as `guests`). Signed-in phones keep their own scores.
 *
 * mode 'lyrics' (or a song with no karaoke analysis): sung along to a video, scored against the song's synced lyrics
 * (frames in lyrics time) instead of a reference melody.
 *   → { results: [{ member_id, user_id, performance_id, score, grade, pitch, timing, rhythm, stability, feedback }] }
 */
import { adminClient, handle, json } from '../_shared/runtime.ts';
import { grade, LYRICS_SCORING_VERSION, scoreLyrics, scorePerformance, SCORING_VERSION, type LyricLine, type Phrase, type RefNote, type ScoreResult } from '../_shared/scoring.ts';

const MAX_FRAMES = 4 * 100 * 60 * 15; // 15 minutes of 10 ms frames

interface SingerIn { member_id?: string; frames: number[]; latency_ms?: number | null; noise_floor_db?: number | null; part?: 0 | 1 }

/** Duet: the singer's half of the lyric lines (0 = first, third, …; 1 = second, fourth, …), each still ending where the next line starts. */
function duetLines(lines: LyricLine[], part: 0 | 1): LyricLine[] {
  const sung = lines.filter((l) => l.start != null && l.text.trim());
  return sung.map((l, i) => ({ ...l, end: l.end ?? sung[i + 1]?.start ?? (l.start! + 8) })).filter((_, i) => i % 2 === part);
}
/** Duet: the singer's half of the melody (alternate phrases), with phrase note indexes renumbered. */
function duetMelody(notes: RefNote[], phrases: Phrase[], part: 0 | 1): { notes: RefNote[]; phrases: Phrase[] } {
  const ps = phrases?.length ? phrases : [];
  if (!ps.length) return { notes: notes.filter((_, i) => i % 2 === part), phrases: [] };
  const outNotes: RefNote[] = [], outPhrases: Phrase[] = [];
  ps.forEach((ph, i) => {
    if (i % 2 !== part) return;
    const idx = ph.noteIdx.map((k) => { outNotes.push(notes[k]!); return outNotes.length - 1; });
    outPhrases.push({ start: ph.start, end: ph.end, noteIdx: idx });
  });
  return { notes: outNotes, phrases: outPhrases };
}

Deno.serve((req) =>
  handle(req, async (body) => {
    // who is calling: validate their JWT with Supabase Auth
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = token ? await adminClient().auth.getUser(token) : { data: { user: null } };
    if (!user) return json({ error: 'sign in required' }, 401);

    const trackId = String(body.track_id ?? '');
    const sessionId = body.session_id ? String(body.session_id) : null;
    const keyShift = Math.max(-12, Math.min(12, Math.round(Number(body.key_shift ?? 0)) || 0));
    const singers = (Array.isArray(body.singers) ? body.singers : []) as SingerIn[];
    if (!trackId || !singers.length || singers.length > 8) return json({ error: 'track_id and 1–8 singers required' }, 400);
    for (const s of singers) {
      if (!Array.isArray(s.frames) || s.frames.length % 4 !== 0 || s.frames.length > MAX_FRAMES || s.frames.some((x) => typeof x !== 'number' || !isFinite(x))) {
        return json({ error: 'frames must be a flat numeric array of [t, f0, conf, rmsDb] quadruples' }, 400);
      }
    }
    const db = adminClient();

    // resolve each singer to a user, enforcing session membership / host rights
    const resolved: { memberId: string | null; userId: string; s: SingerIn }[] = [];
    let hostId: string | null = null;
    if (sessionId) {
      const { data: session } = await db.from('karaoke_sessions').select('id, host_id, status').eq('id', sessionId).maybeSingle();
      if (!session) return json({ error: 'session not found' }, 404);
      hostId = session.host_id;
      const { data: members } = await db.from('session_members').select('id, user_id, kicked').eq('session_id', sessionId);
      const byId = new Map((members ?? []).map((m) => [m.id, m]));
      for (const s of singers) {
        const m = s.member_id ? byId.get(s.member_id) : undefined;
        if (!m || m.kicked) return json({ error: `singer ${s.member_id} is not in this session` }, 403);
        if (session.host_id !== user.id && m.user_id !== user.id) return json({ error: 'only the host can submit other singers' }, 403);
        resolved.push({ memberId: m.id, userId: m.user_id, s });
      }
    } else {
      if (singers.length !== 1) return json({ error: 'solo runs score one singer' }, 400);
      resolved.push({ memberId: null, userId: user.id, s: singers[0]! });
    }

    // reference melody: prefer an analysis from the caller's own upload, else a shared/licensed one, else any
    const { data: analyses } = await db.from('karaoke_analysis')
      .select('id, notes, phrases, created_at, audio_assets!karaoke_analysis_source_asset_id_fkey(owner_id)')
      .eq('track_id', trackId).order('created_at', { ascending: false });
    type A = { id: string; notes: RefNote[]; phrases: Phrase[]; audio_assets: { owner_id: string | null } | null };
    const list = (analyses ?? []) as unknown as A[];
    const analysis = list.find((a) => a.audio_assets?.owner_id === user.id) ?? list.find((a) => a.audio_assets?.owner_id == null) ?? list[0];
    let lines: LyricLine[] = [];
    const useLyrics = body.mode === 'lyrics' || !analysis;
    if (useLyrics) {
      const { data: ly } = await db.from('lyrics').select('granularity, content').eq('track_id', trackId).eq('is_primary', true).maybeSingle();
      lines = ly && ly.granularity !== 'plain' ? ((ly.content as { lines?: LyricLine[] }).lines ?? []) : [];
      if (lines.filter((l) => l.start != null).length < 3) return json({ error: 'this song has no synced lyrics to score against' }, 409);
    }

    const results = [];
    for (const { memberId, userId, s } of resolved) {
      const r: ScoreResult = useLyrics
        ? scoreLyrics({ lines: s.part === 0 || s.part === 1 ? duetLines(lines, s.part) : lines, frames: s.frames, noiseFloorDb: s.noise_floor_db ?? null })
        : scorePerformance({
          ...(s.part === 0 || s.part === 1 ? duetMelody(analysis!.notes, analysis!.phrases, s.part) : { notes: analysis!.notes, phrases: analysis!.phrases }),
          frames: s.frames, keyShift,
          latencyMs: s.latency_ms ?? null, noiseFloorDb: s.noise_floor_db ?? null,
        });
      let tMin = Infinity, tMax = -Infinity;    // frames can arrive out of order: use the real span
      for (let i = 0; i < s.frames.length; i += 4) { tMin = Math.min(tMin, s.frames[i]!); tMax = Math.max(tMax, s.frames[i]!); }
      const durationMs = s.frames.length ? Math.round((tMax - tMin) * 1000) : 0;
      const { data: perf, error } = await db.from('performances').insert({
        session_id: sessionId, member_id: memberId, user_id: userId, track_id: trackId, key_shift: keyShift,
        score: r.score, pitch_score: r.pitch, timing_score: r.timing, rhythm_score: r.rhythm, stability_score: r.stability,
        duration_score: r.duration, transition_score: r.transitions,
        grade: r.grade, scoring_version: useLyrics ? LYRICS_SCORING_VERSION : SCORING_VERSION, duration_ms: Math.max(0, durationMs),
        details: { ...r.details, feedback: r.feedback, expression: r.expression, bonus: r.bonus, analysis_id: useLyrics ? null : analysis!.id, capture: sessionId ? 'session' : 'solo', submitted_by: user.id,
                   ...(s.part === 0 || s.part === 1 ? { duet_part: s.part } : {}), ...(body.party_mode === 'duet' || body.party_mode === 'battle' ? { party_mode: body.party_mode } : {}) },
      }).select('id').single();
      if (error) throw error;
      results.push({ member_id: memberId, user_id: userId, performance_id: perf.id, score: r.score, grade: r.grade,
                     pitch: r.pitch, timing: r.timing, rhythm: r.rhythm, duration: r.duration, transitions: r.transitions,
                     stability: r.stability, expression: r.expression, bonus: r.bonus, mode: useLyrics ? 'lyrics' : 'melody', feedback: r.feedback });
    }
    // Party guests (not logged in) score together on the host's account: one combined performance averaging them
    let guests: { performance_id: string; score: number; grade: string; singers: number; member_ids: (string | null)[] } | null = null;
    if (sessionId && hostId) {
      const isGuest = async (id: string) => (await db.auth.admin.getUserById(id)).data.user?.is_anonymous === true;
      const hostIsGuest = await isGuest(hostId);
      const guestResults: typeof results = [];
      for (const r of results) if (r.user_id !== hostId && await isGuest(r.user_id)) guestResults.push(r);
      if (!hostIsGuest && guestResults.length) {
        const avg = (k: 'score' | 'pitch' | 'timing' | 'rhythm' | 'stability' | 'duration' | 'transitions') =>
          guestResults.reduce((a, r) => a + (r[k] as number), 0) / guestResults.length;
        const score = Math.round(avg('score'));
        const { data: perf, error } = await db.from('performances').insert({
          session_id: sessionId, member_id: null, user_id: hostId, track_id: trackId, key_shift: keyShift,
          score, pitch_score: avg('pitch'), timing_score: avg('timing'), rhythm_score: avg('rhythm'), stability_score: avg('stability'),
          duration_score: avg('duration'), transition_score: avg('transitions'),
          grade: grade(score), scoring_version: useLyrics ? LYRICS_SCORING_VERSION : SCORING_VERSION, duration_ms: 0,
          details: { mode: useLyrics ? 'lyrics' : 'melody', capture: 'session', combined_guests: guestResults.length,
                     guest_member_ids: guestResults.map((r) => r.member_id), guest_performance_ids: guestResults.map((r) => r.performance_id),
                     feedback: [`Combined score of ${guestResults.length} guest${guestResults.length === 1 ? '' : 's'} in your party.`], submitted_by: user.id },
        }).select('id').single();
        if (error) throw error;
        guests = { performance_id: perf.id, score, grade: grade(score), singers: guestResults.length, member_ids: guestResults.map((r) => r.member_id) };
      }
    }
    // group result for party songs: the average of everyone who sang (each person keeps their own score too)
    const group = results.length > 1
      ? (() => { const score = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length); return { score, grade: grade(score), singers: results.length }; })()
      : null;
    return json({ results, group, guests });
  })
);
