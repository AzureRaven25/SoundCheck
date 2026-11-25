'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { liveHit } from '@soundcheck/scoring';
import type { StageLine } from './useStageData';

/**
 * How a line went, from raw pitch frames ([t, f0, conf, rmsDb] × n, song time): the share of the line that was
 * sung and, when a melody is known, how much of it was on the note. null when there were no frames (mic off).
 */
export function rateLine(flat: number[], start: number, end: number, floorDb: number | null, refAt?: (t: number) => number | null, keyShift = 0): number | null {
  let frames = 0, voiced = 0, hits = 0, withRef = 0;
  for (let i = 0; i < flat.length; i += 4) {
    const t = flat[i]!;
    if (t < start || t >= end) continue;
    frames++;
    const f0 = flat[i + 1]!, conf = flat[i + 2]!, db = flat[i + 3]!;
    if (!(f0 > 0 && conf >= 0.6 && (floorDb == null || db >= floorDb + 10))) continue;
    voiced++;
    const ref = refAt?.(t);
    if (ref != null) { withRef++; if (liveHit(f0, ref, keyShift)) hits++; }
  }
  if (!frames) return null;
  const sung = Math.min(1, (voiced * 0.01) / Math.max(0.5, 0.45 * (end - start)));
  return withRef >= 20 ? sung * (hits / withRef) : sung;
}

const LABELS: [number, string, string][] = [[0.85, 'Perfect!', 'text-gold-400'], [0.65, 'Great!', 'text-pink-400'], [0.4, 'Nice!', 'text-cyan-400']];

/** Karaoke-game cheers: as each lyric line ends, a "Perfect! / Great! / Nice!" pop for how it went. */
export function LineCheers({ lines, getTime, rate }: { lines: StageLine[]; getTime: () => number; rate: (start: number, end: number) => number | null }) {
  const sung = useMemo(() => lines.filter((l) => l.start != null && l.text.trim()), [lines]);
  const [pop, setPop] = useState<{ key: number; text: string; cls: string; streak: number } | null>(null);
  const rateRef = useRef(rate);
  useEffect(() => { rateRef.current = rate; });
  useEffect(() => {
    let last = -1, streak = 0, n = 0;
    const iv = setInterval(() => {
      const t = getTime();
      let i = -1;
      for (let k = 0; k < sung.length; k++) { if (sung[k]!.start! <= t) i = k; else break; }
      if (i === last) return;
      const prev = last;
      last = i;
      if (prev < 0 || i !== prev + 1) return;             // only on natural progress, not seeks
      const s = sung[prev]!.start!, e = Math.min(sung[i]!.start!, s + 12);
      const r = rateRef.current(s, e);
      if (r == null) return;
      const hit = LABELS.find(([min]) => r >= min);
      if (!hit) { streak = 0; return; }
      streak = r >= 0.65 ? streak + 1 : 0;
      setPop({ key: ++n, text: hit[1], cls: hit[2], streak });
    }, 150);
    return () => clearInterval(iv);
  }, [sung, getTime]);
  if (!pop) return null;
  return (
    <div key={pop.key} className="pointer-events-none absolute left-1/2 top-2 z-10 animate-pop text-center" aria-hidden>
      <p className={`font-display text-4xl font-black drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)] ${pop.cls}`}>{pop.text}</p>
      {pop.streak >= 3 && <p className="text-sm font-bold uppercase tracking-widest text-ink-50">{pop.streak} in a row</p>}
    </div>
  );
}

/** A burst of confetti (decorative, skipped for reduced motion). */
export function Confetti({ pieces = 90 }: { pieces?: number }) {
  const colors = ['#ff3d9a', '#8b5cff', '#38e1ff', '#ffc94d', '#3ddc97', '#f6f4ff'];
  const items = useMemo(() => Array.from({ length: pieces }, (_, i) => {
    const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;   // stable pseudo-random
    return { left: r(1) * 100, delay: r(2) * 0.8, dur: 2.4 + r(3) * 1.8, dx: `${(r(4) - 0.5) * 240}px`, rot: `${360 + r(5) * 720}deg`, color: colors[i % colors.length]!, w: 6 + r(6) * 6, h: 10 + r(7) * 8 };
  }), [pieces]);
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {items.map((p, i) => (
        <span key={i} className="confetti-piece absolute top-0 block rounded-sm"
          style={{ left: `${p.left}%`, width: p.w, height: p.h, background: p.color, animation: `confetti-fall ${p.dur}s cubic-bezier(.2,.6,.4,1) ${p.delay}s forwards`, ['--dx' as string]: p.dx, ['--rot' as string]: p.rot }} />
      ))}
    </div>
  );
}
