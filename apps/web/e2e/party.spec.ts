import { expect, test, type Browser, type Page } from '@playwright/test';
import { FIXTURE_TRACK, fakeMicrophone, seedFixtureTrack, signUp } from './helpers';

// SoundCheck Party: the host Stage (TV) opens a session, two phones join with the code as anonymous
// users, turn their mics on (injected fake mics singing the test vocal), sing in sync with the shared
// song clock over Realtime, and every singer gets an official score on the TV and on their own phone.
test.use({ permissions: ['microphone'] });
test.beforeAll(seedFixtureTrack);

type W = { __soundcheckJoin: { position: () => number; playing: () => boolean }; __fakeMicSing: (s: number) => void };

async function phone(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`PAGEERROR[${name}]`, e.message.slice(0, 300)));
  await fakeMicrophone(page, process.env.E2E_FAKE_MIC!);
  await page.goto(`/join/${code}`);
  await page.getByLabel('Stage name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByText(`You’re in, ${name}!`)).toBeVisible();
  await page.getByRole('button', { name: 'Turn on my microphone' }).click();
  await expect(page.getByText('Waiting for the song')).toBeVisible({ timeout: 15_000 });
  return page;
}

test('two phones sing together and both get scored', async ({ page, browser }) => {
  test.skip(!process.env.E2E_SONG || !process.env.E2E_FAKE_MIC || !process.env.E2E_SB_URL, 'set E2E_SONG, E2E_FAKE_MIC, E2E_SB_URL/SERVICE and run the worker');
  test.setTimeout(300_000);
  page.on('pageerror', (e) => console.log('PAGEERROR[host]', e.message.slice(0, 300)));
  await signUp(page, 'Party Host');
  await page.goto(`/track/${FIXTURE_TRACK}`);
  await page.getByLabel('Audio file').setInputFiles(process.env.E2E_SONG!);
  await page.getByRole('link', { name: 'Sing on Stage' }).click({ timeout: 200_000 });

  await page.getByRole('radio', { name: /Phones as mics/ }).click();
  await page.getByRole('button', { name: 'Open the party' }).click();
  const code = (await page.getByTestId('pairing-code').textContent({ timeout: 15_000 }))!.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await expect(page.getByRole('img', { name: `QR code to join ${code}` })).toBeVisible();

  const [ana, ben] = await Promise.all([phone(browser, code, 'Ana'), phone(browser, code, 'Ben')]);
  const singers = page.getByRole('list', { name: 'Singers' });
  await expect(singers.getByText('Ana')).toBeVisible();
  await expect(singers.getByText('Ben')).toBeVisible();
  await expect(singers.getByText('mic ready')).toHaveCount(2, { timeout: 15_000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/party-lobby.png` });

  // M8: a phone requests a song; it shows up next on the TV
  await ben.getByRole('button', { name: /Request a song/ }).click();
  await ben.getByPlaceholder('Search songs').fill('Stand by Me');
  await ben.getByRole('button', { name: /Stand by Me/ }).first().click();
  await expect(ben.getByText('Added to the queue')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Up next' }).getByText('Stand by Me')).toBeVisible({ timeout: 15_000 });

  // voice monitoring: phones' mics through the TV speakers over WebRTC
  await page.getByLabel('Hear singers through the speakers').check();
  for (const p of [ana, ben]) await expect(p.getByText('Your voice is on the TV')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Start singing' }).click();
  for (const p of [ana, ben]) {
    await p.waitForFunction(() => (window as unknown as W).__soundcheckJoin?.playing(), null, { timeout: 60_000 });
    await p.evaluate(() => { const w = window as unknown as W; w.__fakeMicSing(w.__soundcheckJoin.position()); });
  }
  await expect(page.getByText(/^Ana \d+%$/)).toBeVisible({ timeout: 20_000 });   // per-singer live chips on the TV
  await expect(ana.getByText(/On pitch \d+%/)).toBeVisible({ timeout: 15_000 });  // live score echoed to the phone
  await expect(ana.getByText('Hello from the testing stage')).toBeVisible({ timeout: 15_000 });
  // phones follow the TV's audio clock (Realtime transport + clock sync); same machine, so compare directly
  const drift = await Promise.all([page.evaluate(() => (window as unknown as { __soundcheckStage: { position: () => number } }).__soundcheckStage.position()),
    ana.evaluate(() => (window as unknown as W).__soundcheckJoin.position())]);
  console.log('E2E clock drift (s)', (drift[1] - drift[0]).toFixed(3));
  expect(Math.abs(drift[1] - drift[0])).toBeLessThan(0.15);
  await page.waitForTimeout(8_000);
  type VoiceStatus = Record<string, { state: string; levelDb: number }>;
  const voices = await page.evaluate(() => (window as unknown as { __soundcheckVoice: () => VoiceStatus }).__soundcheckVoice());
  console.log('E2E voices', JSON.stringify(voices));
  expect(Object.values(voices)).toHaveLength(2);
  for (const v of Object.values(voices)) {
    expect(v.state).toBe('connected');
    expect(v.levelDb).toBeGreaterThan(-60);              // the singer's audio is arriving and playing
  }
  if (process.env.E2E_SHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/party-singing.png` });
    await ana.screenshot({ path: `${process.env.E2E_SHOTS}/party-phone.png` });
  }
  // no Finish click: the song plays to the end and the Stage scores everyone automatically

  const results = page.getByRole('dialog', { name: 'Results' });
  await expect(results.getByText('Ana')).toBeVisible({ timeout: 60_000 });
  await expect(results.getByText('Ben')).toBeVisible();
  for (const p of [ana, ben]) {
    const card = p.getByRole('dialog', { name: 'Your score' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    const score = Number(await card.locator('.text-8xl').textContent());
    console.log('E2E party score', score);
    expect(score).toBeGreaterThanOrEqual(60);
  }
  if (process.env.E2E_SHOTS) {
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/party-results.png`, fullPage: true });
  }
  // the party continues with the requested song in the same session (phones stay joined)
  const sid = page.url();
  await page.getByRole('button', { name: 'Sing next' }).click();
  await expect(page).toHaveURL(/\/stage\/[0-9a-f-]+\?party=[0-9a-f-]+/);
  await expect(page.getByText(/isn’t karaoke-ready yet|Code [A-Z0-9]{6}/).first()).toBeVisible({ timeout: 20_000 });
  console.log("E2E party continued from", sid);
});
