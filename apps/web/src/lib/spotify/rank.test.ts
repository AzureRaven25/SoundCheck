import { describe, expect, it } from 'vitest';
import { rankTaste, tasteScore } from './rank';

const NOW = Date.parse('2025-01-01T00:00:00Z');
const t = (track_id: string, plays: number, skip_rate: number, last_played: string) => ({ track_id, plays, skip_rate, last_played });

describe('tasteScore', () => {
  it('rises with plays, falls with skips and age', () => {
    const base = tasteScore(t('a', 20, 0, '2024-12-01T00:00:00Z'), NOW);
    expect(tasteScore(t('a', 40, 0, '2024-12-01T00:00:00Z'), NOW)).toBeGreaterThan(base);
    expect(tasteScore(t('a', 20, 0.8, '2024-12-01T00:00:00Z'), NOW)).toBeLessThan(base);
    expect(tasteScore(t('a', 20, 0, '2019-12-01T00:00:00Z'), NOW)).toBeLessThan(base);
  });
  it('still counts old favorites', () => {
    expect(tasteScore(t('a', 100, 0, '2010-01-01T00:00:00Z'), NOW)).toBeGreaterThan(0);
  });
});

describe('rankTaste', () => {
  it('orders by score, keeps the best version of each song, drops unplayed', () => {
    const rows = [
      t('old-hit', 200, 0, '2016-01-01T00:00:00Z'),
      t('new-love', 30, 0, '2024-12-20T00:00:00Z'),
      t('skipped', 50, 0.9, '2024-12-20T00:00:00Z'),
      t('new-love', 2, 0, '2024-01-01T00:00:00Z'),
      t('never', 0, 0, '2024-12-20T00:00:00Z'),
    ];
    const ranked = rankTaste(rows, NOW);
    expect(ranked.map((r) => r.track_id)).toEqual(['new-love', 'old-hit', 'skipped']);
    expect(ranked[0]!.plays).toBe(30);
  });
});
