/** Ranking for the "From your Spotify" shelf: the imported songs you play most, lately, without skipping. */

export interface TastePlay { track_id: string; plays: number; skip_rate: number; last_played: string }

const YEAR_MS = 365 * 86_400_000;

/** Plays, discounted for skipping (up to 90%) and for time since you last played it (half-life of about 8 months). */
export function tasteScore(t: TastePlay, now = Date.now()): number {
  const age = Math.max(0, now - Date.parse(t.last_played));
  const recency = 0.25 + 0.75 * Math.exp(-age / YEAR_MS);
  return Math.log1p(Math.max(0, t.plays)) * (1 - 0.9 * Math.min(1, Math.max(0, t.skip_rate))) * recency;
}

/** Best first, one entry per catalog track (two Spotify versions can match the same song). */
export function rankTaste<T extends TastePlay>(rows: T[], now = Date.now()): T[] {
  const best = new Map<string, { row: T; score: number }>();
  for (const row of rows) {
    if (row.plays < 1) continue;
    const score = tasteScore(row, now);
    const cur = best.get(row.track_id);
    if (!cur || score > cur.score) best.set(row.track_id, { row, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map((x) => x.row);
}
