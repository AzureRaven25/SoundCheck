/**
 * Acquisition: full songs from open sources, and bulk import of music the user owns.
 *
 *  - Search → "Full songs from open sources" → play an Openverse (Jamendo) and an Audius result: playback must pass
 *    30 s and report the real (> 60 s) duration, i.e. a complete recording, not a preview. Needs internet.
 *  - Import a ZIP like a Bandcamp download (two tagged MP3s + an M3U playlist + an EAC rip log): songs match or join
 *    the catalog, a playlist is created, AccurateRip results are kept, a second import is detected as duplicates,
 *    and the karaoke pipeline turns the matched song into a karaoke track. Needs E2E_SONG + the local worker.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_TRACK, seedFixtureTrack, signUp } from './helpers';

async function playsInFull(page: Page) {
  const audio = page.getByTestId('player-audio');
  await expect(page.getByTestId('source-label')).toContainText('Full track', { timeout: 30_000 });
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration), { timeout: 30_000 }).toBeGreaterThan(60);
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 60_000, intervals: [2000] }).toBeGreaterThan(31);
}

test.describe('open sources', () => {
  test.setTimeout(180_000);
  for (const [name, needle] of [['Openverse (Jamendo)', 'Openverse'], ['Audius', 'Audius']] as const) {
    test(`plays a complete recording from ${name}`, async ({ page }) => {
      await page.goto('/search?q=love');
      const status = page.getByTestId(`source-${needle.toLowerCase()}`);
      await expect(status).toBeVisible({ timeout: 45_000 });
      await expect(status).not.toContainText('unavailable');
      const row = page.getByTestId('source-results').locator('li').filter({ hasText: ` · ${needle}` }).first();
      await row.getByRole('button', { name: /^Play / }).click();
      await playsInFull(page);
      await expect(page.getByTestId('source-label')).toContainText(needle);
    });
  }
});

function makeZip(): string {
  const song = process.env.E2E_SONG!;
  const dir = mkdtempSync(join(tmpdir(), 'sc-import-'));
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  ff(['-i', song, '-metadata', 'title=Testing Stage', '-metadata', 'artist=Good News', '-metadata', 'album=Testing Stage EP',
    '-metadata', 'track=1', '-b:a', '192k', join(dir, '1.mp3')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=70', '-metadata', 'title=Tuning Fork Waltz', '-metadata', 'artist=Good News',
    '-metadata', 'album=Testing Stage EP', '-metadata', 'track=2', '-b:a', '128k', join(dir, '2.mp3')]);
  const folder = 'Good News - Testing Stage EP';
  const log = 'Exact Audio Copy V1.6 from 23. October 2020\n\nTrack  1\n\n     Accurately ripped (confidence 7)  [ABCDEF01]  (AR v2)\n\nTrack  2\n\n     Track not present in AccurateRip database\n';
  const zip = zipSync({
    [`${folder}/01 Testing Stage.mp3`]: readFileSync(join(dir, '1.mp3')),
    [`${folder}/02 Tuning Fork Waltz.mp3`]: readFileSync(join(dir, '2.mp3')),
    [`${folder}/Road trip.m3u`]: new TextEncoder().encode('#EXTM3U\n#EXTINF:70,Good News - Tuning Fork Waltz\n02 Tuning Fork Waltz.mp3\n01 Testing Stage.mp3\n'),
    [`${folder}/Testing Stage EP.log`]: new TextEncoder().encode(log),
    [`${folder}/cover.jpg`]: new Uint8Array([0xff, 0xd8, 0xff]),
  });
  const out = join(dir, 'Good News - Testing Stage EP.zip');
  writeFileSync(out, zip);
  return out;
}

test('bulk import: ZIP with playlist and rip log, duplicates, karaoke', async ({ page }) => {
  test.skip(!process.env.E2E_SONG, 'needs E2E_SONG');
  test.setTimeout(420_000);
  await seedFixtureTrack();
  const zip = makeZip();
  await signUp(page, 'Collector');
  await page.goto('/import');
  await page.getByLabel('Music files').setInputFiles(zip);
  await page.getByLabel('Where these files came from').selectOption('CD rip');
  await page.getByRole('button', { name: 'Import 2 songs' }).click();

  const summary = page.getByTestId('import-summary');
  await expect(summary).toContainText('2 of 2 · 2 imported', { timeout: 120_000 });
  await expect(summary).toContainText('1 CD rip log read');
  const items = page.getByTestId('import-items');
  // the tagged song joined the existing catalog row (same title, artist, ~27 s)
  await expect(items.locator('li').filter({ hasText: 'Testing Stage' }).first()).toContainText('matched');
  await expect(items).toContainText('AccurateRip verified (confidence 7)');
  await expect(items).toContainText('karaoke queued');
  await expect(page.getByText('Playlist “Road trip”: 2 of 2 songs')).toBeVisible();
  const toneHref = await items.getByRole('link', { name: 'Tuning Fork Waltz' }).getAttribute('href');

  // the same files again: recognised by content hash
  await page.reload();
  await page.getByLabel('Music files').setInputFiles(zip);
  await page.getByRole('button', { name: 'Import 2 songs' }).click();
  await expect(summary).toContainText('2 already in your library', { timeout: 60_000 });

  // the imported copy plays in full and becomes karaoke-ready through the normal pipeline
  await page.goto(`/track/${FIXTURE_TRACK}`);
  await expect(page.getByTestId('availability')).toHaveAttribute('data-level', /karaoke_ok|karaoke_ready/);
  await expect.poll(async () => {
    await page.reload();
    return page.getByTestId('availability').getAttribute('data-level');
  }, { timeout: 300_000, intervals: [10_000] }).toBe('karaoke_ready');

  // an instrumental (no vocals, no beat) must still finish processing
  await page.goto(toneHref!);
  await expect.poll(async () => {
    await page.reload();
    return page.getByTestId('availability').getAttribute('data-level');
  }, { timeout: 300_000, intervals: [10_000] }).toBe('karaoke_ready');
});

// Needs the local worker to have processed a shared open-licensed song with transcribed lyrics
// (scripts/process_open_catalog.py / admin_request_processing). Skipped when none is ready.
test('open-licensed song: lyrics by ear, listed on /sing, opens on Stage', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Busker');
  await page.goto('/sing');
  const everyone = page.getByRole('region', { name: 'Ready for everyone' }).or(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ready for everyone' }) }));
  const sing = everyone.first().getByRole('link', { name: /^Sing / }).first();
  test.skip(!(await sing.isVisible().catch(() => false)), 'no shared karaoke version with lyrics yet');
  const title = (await sing.getAttribute('aria-label'))!.replace(/^Sing /, '');
  const href = (await sing.getAttribute('href'))!;
  // the song page shows the transcribed words
  await page.goto(`/track/${href.split('/').pop()}`);
  await expect(page.getByText(/Lyrics transcribed automatically/)).toBeVisible({ timeout: 20_000 });
  await page.goto(href);
  await expect(page.getByRole('heading', { name: 'Ready to sing?' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/transcribed automatically from the vocals/)).toBeVisible();
  expect(title.length).toBeGreaterThan(0);
});
