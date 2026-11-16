import type { LyricLine, Note } from '../api';

/** Index of the line being sung at time t (or the last line that has started), -1 before the first. */
export function currentLineIndex(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * When the singing in a line actually stops. LRC lines run until the next line
 * starts, which often includes a long instrumental gap; the melody tells us
 * where the last sung note in the line ends, so the highlight wipe finishes
 * with the voice instead of crawling through the gap.
 */
export function sungEnd(line: LyricLine, notes: Note[]): number {
  let end = -1;
  for (const n of notes) {
    if (n.start >= line.end) break;
    if (n.start >= line.start - 0.15) end = Math.max(end, Math.min(n.end, line.end));
  }
  return end > line.start ? end : line.end;
}

/** Seconds until the next sung line if we're in a gap of at least `minGap` seconds, else null. */
export function countdown(lines: LyricLine[], t: number, minGap = 4): number | null {
  const i = currentLineIndex(lines, t);
  const next = lines.slice(i + 1).find((l) => l.text.trim());
  if (!next) return null;
  const cur = i >= 0 ? lines[i] : null;
  const gapStart = cur && cur.text.trim() ? cur.end : (cur?.start ?? 0);
  if (next.start - gapStart < minGap) return null;
  const left = next.start - t;
  return left > 0 && left <= 3.2 ? left : null;
}
