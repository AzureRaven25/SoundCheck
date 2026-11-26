import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { signUp } from './helpers';

// Spotify taste import: a signed-in singer picks their Spotify export zip in Settings; it's summarized in the
// browser, matched to the catalog, and shows up on the home feed ("From your Spotify", "Picked for you").
// The history here is synthetic (made-up artist and songs). Needs E2E_SB_URL / E2E_SB_SERVICE to seed the catalog.

const ARTIST = { id: '5ca1ab1e-0000-4000-8000-00000000a501', name: 'Lantern Test Choir' };
const LOVED = { id: '5ca1ab1e-0000-4000-8000-00000000a511', title: 'Paper Boats Overhead' };
const OTHER = { id: '5ca1ab1e-0000-4000-8000-00000000a512', title: 'Quiet Harbor Lights' };

async function seedCatalog() {
  const url = process.env.E2E_SB_URL, key = process.env.E2E_SB_SERVICE;
  if (!url || !key) return false;
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  const post = (table: string, conflict: string, body: unknown) =>
    fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  await post('artists', 'id', ARTIST);
  await post('tracks', 'id', [LOVED, OTHER].map((t) => ({ ...t, artist_credit: ARTIST.name, duration_ms: 200_000 })));
  await post('track_artists', 'track_id,position', [LOVED, OTHER].map((t) => ({ track_id: t.id, position: 0, artist_id: ARTIST.id })));
  return true;
}

function exportZip(): Buffer {
  const stream = (title: string, ts: string, o: Record<string, unknown> = {}) => ({
    ts, platform: 'test', ms_played: 210_000, conn_country: 'ZZ', ip_addr: '203.0.113.7',
    master_metadata_track_name: title, master_metadata_album_artist_name: ARTIST.name, master_metadata_album_album_name: 'Test Album',
    spotify_track_uri: 'spotify:track:0000000000000000000001', episode_name: null, spotify_episode_uri: null,
    audiobook_title: null, audiobook_uri: null, reason_start: 'clickrow', reason_end: 'trackdone', skipped: false, incognito_mode: false, ...o,
  });
  const audio = [
    ...Array.from({ length: 12 }, (_, i) => stream(`${LOVED.title} - Remastered 2020`, `2024-0${1 + (i % 9)}-0${1 + (i % 9)}T12:00:00Z`)),
    stream('Some Podcast Bit', '2024-05-05T10:00:00Z', { master_metadata_track_name: null, master_metadata_album_artist_name: null, episode_name: 'Ep 1', spotify_episode_uri: 'spotify:episode:x' }),
  ];
  return Buffer.from(zipSync({
    'Spotify Extended Streaming History/Streaming_History_Audio_2024_0.json': strToU8(JSON.stringify(audio)),
    'Spotify Extended Streaming History/Streaming_History_Video_2024.json': strToU8('[]'),
  }));
}

test('Spotify export: import in settings, tailored home shelves, delete', async ({ page }) => {
  test.skip(!(await seedCatalog()), 'needs E2E_SB_URL and E2E_SB_SERVICE (supabase status -o env)');
  test.setTimeout(90_000);

  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST') sent.push(r.postData() ?? ''); });

  await signUp(page, `Spotty ${Date.now().toString(36)}`);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Your Spotify listening' })).toBeVisible();
  await page.getByLabel('Spotify data export').setInputFiles({ name: 'my_spotify_data.zip', mimeType: 'application/zip', buffer: exportZip() });
  await expect(page.getByText('1 of your songs are in the catalog.')).toBeVisible();
  const summary = page.getByTestId('spotify-import-summary');
  await expect(summary).toContainText('12 plays');
  await expect(summary).toContainText('1 artists and 1 songs found in the catalog');

  // only the aggregated summary went to the server: no IPs, countries or per-stream timestamps
  const upload = sent.find((b) => b.includes('p_summary'));
  expect(upload).toBeTruthy();
  for (const leak of ['203.0.113.7', 'ip_addr', 'conn_country', 'Some Podcast Bit', '2024-05-05T12'] ) expect(upload).not.toContain(leak);

  await page.goto('/');
  const fromSpotify = page.getByRole('region', { name: 'From your Spotify' });
  await expect(fromSpotify.getByText(LOVED.title)).toBeVisible();
  const picked = page.getByRole('region', { name: 'Picked for you' });
  await expect(picked).toContainText(`Because you've been listening to ${ARTIST.name}`);
  await expect(picked.getByText(OTHER.title)).toBeVisible();
  await expect(picked.getByText(LOVED.title)).toHaveCount(0);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete imported listening' }).click();
  await expect(page.getByText('Deleted your imported Spotify listening.')).toBeVisible();
  await expect(summary).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'From your Spotify' })).toHaveCount(0);
});
