/** Automated accessibility checks (axe-core, WCAG 2 A/AA) on the main public pages. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = ['/', '/search?q=love', '/sing', '/genre', '/import', '/login', `/track/5ca1ab1e-0000-4000-8000-000000000001`];

for (const path of PAGES) {
  test(`a11y ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => {});
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of serious) console.log(path, v.id, v.impact, v.nodes.length, v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | '));
    expect(serious.map((v) => v.id)).toEqual([]);
  });
}
