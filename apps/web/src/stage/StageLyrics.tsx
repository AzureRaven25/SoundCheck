'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { StageLine, StageNote } from './useStageData';

/** Index of the line active at t (last line whose start ≤ t), -1 before the first. */
export function lineAt(lines: StageLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid]!.start ?? Infinity) <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Words for a line: real word timing when available, else spread over the sung notes of the line. */
export function wordsOf(line: StageLine, next: StageLine | undefined, notes: StageNote[]) {
  if (line.words?.length) return line.words;
  const start = line.start ?? 0;
  const end = next?.start ?? line.end ?? start + 4;
  const sungEnd = Math.max(start + 0.5, ...notes.filter((n) => n.start >= start - 0.1 && n.start < end).map((n) => n.end));
  const words = line.text.split(/\s+/).filter(Boolean);
  const total = words.reduce((s, w) => s + Math.max(1, w.length), 0);
  let acc = start;
  return words.map((w) => {
    const d = ((sungEnd - start) * Math.max(1, w.length)) / total;
    const out = { start: acc, end: acc + d, text: w };
    acc += d;
    return out;
  });
}

const Line = memo(function Line({ words, id }: { words: { text: string }[]; id: string }) {
  return (
    <p data-line={id} className="font-display text-[clamp(1.75rem,min(4.6vw,7.5vh),4.75rem)] font-extrabold leading-tight tracking-tight">
      {words.map((w, i) => (
        <span key={i} data-w={i} className="stage-word">{w.text}{i < words.length - 1 ? ' ' : ''}</span>
      ))}
    </p>
  );
});

/**
 * Full-screen lyrics: current line with a per-word colour wipe, next line waiting below, and a
 * 3-2-1 countdown before singing resumes after a long instrumental break. Word progress is written
 * straight to CSS variables each animation frame (no React re-render at 60 fps).
 */
export function StageLyrics({ lines, notes, getTime }: { lines: StageLine[]; notes: StageNote[]; getTime: () => number }) {
  const sung = useMemo(() => lines.filter((l) => l.text.trim() && l.start != null), [lines]);
  const [idx, setIdx] = useState(-1);
  const [countdown, setCountdown] = useState<number | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const timed = useMemo(() => sung.map((l, i) => wordsOf(l, sung[i + 1], notes)), [sung, notes]);

  useEffect(() => {
    let raf = 0;
    let lastIdx = -2, lastCd: number | null = null;
    const tick = () => {
      const t = getTime();
      const i = lineAt(sung, t);
      // show the line from its start until the next one begins
      if (i !== lastIdx) { lastIdx = i; setIdx(i); }
      // countdown before a line that follows ≥ 4 s of silence
      const nextLine = sung[i + 1];
      const prevEnd = i >= 0 ? (timed[i]![timed[i]!.length - 1]?.end ?? sung[i]!.start!) : 0;
      let cd: number | null = null;
      if (nextLine && nextLine.start! - prevEnd >= 4 && nextLine.start! - t <= 3 && nextLine.start! > t) cd = Math.ceil(nextLine.start! - t);
      if (cd !== lastCd) { lastCd = cd; setCountdown(cd); }
      // word wipe
      const el = box.current?.querySelector<HTMLElement>('[data-line="cur"]');
      if (el && i >= 0) {
        const ws = timed[i]!;
        el.querySelectorAll<HTMLElement>('[data-w]').forEach((span, k) => {
          const w = ws[k];
          const p = !w ? 0 : t <= w.start ? 0 : t >= w.end ? 1 : (t - w.start) / Math.max(0.05, w.end - w.start);
          span.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sung, timed, getTime]);

  if (!sung.length) {
    return <p className="text-center font-display text-3xl font-bold text-ink-500">No synced lyrics for this song yet. Sing along with the melody guide.</p>;
  }
  const cur = idx >= 0 ? timed[idx] : null;
  const next = timed[idx + 1];
  return (
    <div ref={box} className="flex flex-col items-center justify-center text-center" aria-live="off">
      <div className="mb-3 flex h-5 gap-4" aria-hidden>
        {countdown != null && [3, 2, 1].map((n) => (
          <span key={n} className={`h-5 w-5 rounded-full transition-colors ${countdown >= n ? 'bg-pink-500' : 'bg-ink-700'}`} />
        ))}
      </div>
      {cur ? <Line key={`c${idx}`} id="cur" words={cur} /> : <p className="font-display text-4xl font-bold text-ink-500">{idx < 0 ? 'Get ready…' : ''}</p>}
      <div className="mt-4 min-h-[2.5rem] text-ink-500">
        {next && <p className="font-display text-[clamp(1.1rem,min(2.6vw,4.2vh),2.6rem)] font-bold leading-tight">{next.map((w) => w.text).join(' ')}</p>}
      </div>
    </div>
  );
}
