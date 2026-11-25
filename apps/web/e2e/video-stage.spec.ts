import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { FIXTURE_TRACK, seedFixtureTrack, signUp } from './helpers';

// Sing along to YouTube: Stage over YouTube's own players with synced lyrics, a shared lyrics-timing correction,
// and the lyrics score (no reference melody). Needs the local stack (E2E_SB_URL / E2E_SB_SERVICE / E2E_SB_ANON) and
// network access to YouTube for the player.
test.beforeAll(seedFixtureTrack);
const env = () => ({ url: process.env.E2E_SB_URL, service: process.env.E2E_SB_SERVICE, anon: process.env.E2E_SB_ANON });

test('Stage plays a pasted YouTube video with synced lyrics and saves the timing fix for everyone', async ({ page }) => {
  test.skip(!env().url, 'set E2E_SB_URL / E2E_SB_SERVICE');
  test.setTimeout(120_000);
  await signUp(page, 'Video Singer');
  await page.goto(`/stage/${FIXTURE_TRACK}?video=1`);
  await page.getByLabel('Kind of video').selectOption('original');
  await page.getByLabel('YouTube link').fill('https://www.youtube.com/watch?v=pKtLNYNWbBw');
  await page.getByRole('button', { name: 'Use video' }).click();
  await expect(page.getByTestId('main-video').locator('iframe')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Score me with this device’s microphone').uncheck();
  await page.getByRole('button', { name: 'Start singing' }).click({ timeout: 30_000 });
  // the fixture's first line is at 2 s of the song (headless Chromium can't play the video: drive the clock)
  await page.evaluate(() => { (window as unknown as { __soundcheckStage: { clock: { videoTime: () => number } } }).__soundcheckStage.clock.videoTime = () => 2.5; });
  await expect(page.locator('[data-line="cur"]')).toHaveText('Hello from the testing stage', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Lyrics later' }).click();
  await page.getByRole('button', { name: 'Lyrics later' }).click();
  await expect(page.getByRole('group', { name: 'Lyrics timing' })).toContainText('+0.5 s');
  // saved (debounced) and shared as a median
  await expect.poll(async () => {
    const sb = createClient(env().url!, env().service!);
    const { data } = await sb.rpc('video_offsets', { p_track_id: FIXTURE_TRACK });
    return (data as { video_id: string; offset_ms: number }[] | null)?.find((r) => r.video_id === 'pKtLNYNWbBw')?.offset_ms;
  }, { timeout: 10_000 }).toBe(500);
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('lyrics score: singing along to the lines is scored and stored', async () => {
  const { url, service, anon } = env();
  test.skip(!url || !service || !anon, 'set E2E_SB_URL / E2E_SB_SERVICE / E2E_SB_ANON');
  const admin = createClient(url!, service!);
  const email = `lyrics-${Date.now()}@soundcheck.test`;
  await admin.auth.admin.createUser({ email, password: 'correct-horse-battery', email_confirm: true });
  const sb = createClient(url!, anon!);
  await sb.auth.signInWithPassword({ email, password: 'correct-horse-battery' });

  // sing each fixture line (2, 8, 14, 20 s) for 4 s, moving between C-major notes, silent in between
  const melody = [60, 62, 64, 65, 67, 65, 64, 62];
  const frames: number[] = [];
  for (let t = 0; t < 27; t += 0.01) {
    const line = [2, 8, 14, 20].find((s) => t >= s && t < s + 4);
    if (line == null) { frames.push(+t.toFixed(2), 0, 0.1, -60); continue; }
    const midi = melody[Math.floor((t - line) / 0.5) % melody.length]!;
    frames.push(+t.toFixed(2), 440 * 2 ** ((midi - 69) / 12), 0.95, -20);
  }
  const { data, error } = await sb.functions.invoke('score-performance', {
    body: { track_id: FIXTURE_TRACK, mode: 'lyrics', singers: [{ frames, latency_ms: 0, noise_floor_db: -50 }] },
  });
  expect(error).toBeNull();
  const r = (data as { results: { score: number; mode: string; timing: number; pitch: number; performance_id: string }[] }).results[0]!;
  expect(r.mode).toBe('lyrics');
  expect(r.score).toBeGreaterThan(70);
  expect(r.timing).toBeGreaterThan(0.8);
  const { data: perf } = await admin.from('performances').select('scoring_version, details').eq('id', r.performance_id).single();
  expect(perf!.scoring_version).toBe('lyrics-1.0.0');
});

test('no lyrics: paste them, tap along to time them, and they become the song’s synced lyrics', async ({ page }) => {
  const { url, service } = env();
  test.skip(!url || !service, 'set E2E_SB_URL / E2E_SB_SERVICE');
  test.setTimeout(120_000);
  const admin = createClient(url!, service!);
  const id = crypto.randomUUID();
  await admin.from('tracks').insert({ id, title: `Zzq Untimed Song ${Date.now()}`, artist_credit: 'Nobody Qqx', duration_ms: 183000 });
  await signUp(page, 'Lyric Timer');
  await page.goto(`/stage/${id}`);
  await page.getByLabel('Kind of video').selectOption('original');
  await page.getByLabel('YouTube link').fill('pKtLNYNWbBw');
  await page.getByRole('button', { name: 'Use video' }).click();
  await expect(page.getByTestId('main-video').locator('iframe')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add and time them' }).click();
  await page.getByRole('textbox', { name: 'Lyrics' }).fill('First line here\nSecond line here\nThird line here');
  await page.getByRole('button', { name: 'Next: tap along' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const tap = page.getByRole('button', { name: 'Tap: this line starts now' });
  // headless Chromium can't play YouTube's video, so drive the song clock through the dev-only Stage hook
  for (const t of [3.2, 7.5, 12.25]) {
    await page.evaluate((x) => { (window as unknown as { __soundcheckStage: { clock: { videoTime: () => number } } }).__soundcheckStage.clock.videoTime = () => x; }, t);
    await tap.click();
  }
  await page.getByRole('button', { name: 'Save for everyone' }).click();
  await expect(page.getByRole('status')).toContainText('synced for everyone');
  const { data } = await admin.from('lyrics').select('provider, granularity, content').eq('track_id', id).eq('is_primary', true).single();
  expect(data!.provider).toBe('manual');
  const lines = (data!.content as { lines: { start: number; text: string }[] }).lines;
  expect(lines.map((l) => l.text)).toEqual(['First line here', 'Second line here', 'Third line here']);
  expect(lines.map((l) => l.start)).toEqual([3.2, 7.5, 12.25]);
  await admin.from('tracks').delete().eq('id', id);
});
