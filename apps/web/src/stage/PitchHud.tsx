'use client';
import { useEffect, useRef } from 'react';
import type { StageNote } from './useStageData';

export interface SingerTrail {
  id: string;
  color: string;
  /** Recent [songTime, midi | null] samples, oldest first. */
  points: [number, number | null][];
}

const PAST = 2, FUTURE = 5;

/**
 * Scrolling melody highway on a canvas: reference notes (shifted by the key change) flow right-to-left
 * past a playhead; each singer's live pitch draws as a coloured trail, folded to the octave nearest
 * the reference so low and high voices both line up with the guide.
 */
export function PitchHud({ notes, keyShift, getTime, getTrails, range }: {
  notes: StageNote[]; keyShift: number; getTime: () => number; getTrails: () => SingerTrail[];
  range: { min: number; max: number } | null;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const lo = (range?.min ?? Math.min(...notes.map((n) => n.pitch), 55)) + keyShift - 2;
    const hi = (range?.max ?? Math.max(...notes.map((n) => n.pitch), 72)) + keyShift + 2;
    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const t = getTime();
      const head = w * (PAST / (PAST + FUTURE));
      const pps = w / (PAST + FUTURE);
      const rowH = h / Math.max(1, hi - lo + 1);
      const y = (m: number) => h - (m - lo + 0.5) * rowH;
      // octave guides
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 1;
      for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) { g.beginPath(); g.moveTo(0, y(m)); g.lineTo(w, y(m)); g.stroke(); }
      // reference notes
      let activePitch: number | null = null;
      for (const n of notes) {
        if (n.end < t - PAST || n.start > t + FUTURE) continue;
        const p = n.pitch + keyShift;
        const x = head + (n.start - t) * pps, len = Math.max(4, (n.end - n.start) * pps - 2);
        const active = n.start <= t && t < n.end;
        if (active) activePitch = p;
        g.fillStyle = active ? '#ff3d9a' : n.end < t ? 'rgba(167,162,189,0.35)' : 'rgba(56,225,255,0.85)';
        const bh = Math.max(6, rowH * 0.7);
        g.beginPath();
        g.roundRect(x, y(p) - bh / 2, len, bh, bh / 2);
        g.fill();
      }
      // reference note at a given song time (for folding each trail point to its own note's octave)
      const refAt = (time: number): number | null => {
        let a = 0, b = notes.length - 1;
        while (a <= b) {
          const m = (a + b) >> 1;
          if (notes[m]!.end <= time) a = m + 1; else if (notes[m]!.start > time) b = m - 1; else return notes[m]!.pitch + keyShift;
        }
        return null;
      };
      // singers
      for (const s of getTrails()) {
        g.strokeStyle = s.color;
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.beginPath();
        let pen = false;
        for (const [pt, midi] of s.points) {
          if (midi == null || pt < t - PAST) { pen = false; continue; }
          let m = midi;
          const near = refAt(pt) ?? activePitch ?? (lo + hi) / 2;
          while (m - near > 6) m -= 12;
          while (near - m > 6) m += 12;
          const x = head + (pt - t) * pps;
          if (!pen) { g.moveTo(x, y(m)); pen = true; } else g.lineTo(x, y(m));
        }
        g.stroke();
      }
      // playhead
      g.fillStyle = 'rgba(246,244,255,0.9)';
      g.fillRect(head - 1.5, 0, 3, h);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [notes, keyShift, getTime, getTrails, range]);
  return <canvas ref={canvas} className="h-full w-full" aria-label="Melody guide" role="img" />;
}
