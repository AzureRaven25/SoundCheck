'use client';
/**
 * Stage visualiser: a scrolling pitch lane (semitone grid with note names, the melody when known, each singer's
 * glowing pitch trail coloured by how in-tune it is, and a live note readout), the singer's waveform and frequency
 * spectrum from the mic, and level meters. Drawn on one canvas; everything comes from the microphones (YouTube's
 * audio can't be analysed).
 */
import { useEffect, useRef } from 'react';
import type { SingerTrail } from './PitchHud';
import type { StageNote } from './useStageData';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const PAST = 3, FUTURE = 4;
const noteLabel = (m: number) => `${NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;

export interface SingerLevel { color: string; db: number }

export function VoiceVisualizer({ getTime, getTrails, notes = [], keyShift = 0, analyser, getLevels }: {
  getTime: () => number; getTrails: () => SingerTrail[]; notes?: StageNote[]; keyShift?: number;
  /** the solo singer's mic (waveform + spectrum); null in party mode */
  analyser: AnalyserNode | null;
  /** current loudness per singer (dBFS), for the meters */
  getLevels: () => SingerLevel[];
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const wave = analyser ? new Float32Array(analyser.fftSize) : null;
    const peaks = new Map<string, { db: number; at: number }>();
    let center = 62, raf = 0;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const t = getTime();
      const meterW = 18 + 8 * Math.max(1, getLevels().length);
      const specH = analyser ? Math.round(h * 0.26) : 0;
      const laneW = w - meterW - 8, laneH = h - specH - (specH ? 6 : 0);
      const labelW = 34;
      const head = labelW + (laneW - labelW) * (PAST / (PAST + FUTURE));
      const pps = (laneW - labelW) / (PAST + FUTURE);
      const trails = getTrails();

      // vertical range: follow the melody, else the singers' recent median, smoothly
      const recent: number[] = [];
      for (const s of trails) for (const [pt, m] of s.points) if (m != null && pt > t - PAST) recent.push(m);
      const near = notes.filter((n) => n.end > t - PAST && n.start < t + FUTURE).map((n) => n.pitch + keyShift);
      const pool = near.length ? near : recent;
      if (pool.length) {
        const sorted = [...pool].sort((a, b) => a - b);
        center += (sorted[sorted.length >> 1]! - center) * 0.04;
      }
      const span = 20;
      const lo = center - span / 2;
      const y = (m: number) => laneH - ((m - lo) / span) * laneH;

      // lane background + semitone grid with note names
      const bg = g.createLinearGradient(0, 0, 0, laneH);
      bg.addColorStop(0, 'rgba(139,92,255,0.10)'); bg.addColorStop(1, 'rgba(56,225,255,0.04)');
      g.fillStyle = bg; g.fillRect(0, 0, laneW, laneH);
      g.font = '600 10px ui-sans-serif, system-ui';
      g.textBaseline = 'middle';
      // label as many note names as fit: every natural note, else C E G A, else just C
      const rowH = laneH / span;
      const labelled = rowH >= 12 ? [0, 2, 4, 5, 7, 9, 11] : rowH >= 7 ? [0, 4, 7, 9] : [0];
      for (let m = Math.ceil(lo); m <= lo + span; m++) {
        const yy = y(m), pc = ((m % 12) + 12) % 12, isC = pc === 0, natural = labelled.includes(pc);
        g.fillStyle = isC ? 'rgba(255,255,255,0.10)' : natural ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.02)';
        g.fillRect(labelW, yy - 0.5, laneW - labelW, 1);
        if (natural) { g.fillStyle = isC ? 'rgba(246,244,255,0.85)' : 'rgba(167,162,189,0.6)'; g.fillText(noteLabel(m), 4, yy); }
      }

      // waveform, faint, behind the trails
      if (analyser && wave) {
        analyser.getFloatTimeDomainData(wave);
        g.strokeStyle = 'rgba(56,225,255,0.18)'; g.lineWidth = 1.5; g.beginPath();
        const step = Math.max(1, Math.floor(wave.length / (laneW - labelW)));
        for (let i = 0, x = labelW; i < wave.length; i += step, x++) {
          const yy = laneH / 2 + wave[i]! * laneH * 0.9;
          if (i === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
        }
        g.stroke();
      }

      // melody notes (when the song has one); lit when a singer is on them
      for (const n of notes) {
        if (n.end < t - PAST || n.start > t + FUTURE) continue;
        const p = n.pitch + keyShift, x = head + (n.start - t) * pps, len = Math.max(4, (n.end - n.start) * pps - 2);
        const active = n.start <= t && t < n.end;
        const hit = active && trails.some((s) => { const last = s.points[s.points.length - 1]; return last?.[1] != null && Math.abs(((last[1] - p + 6) % 12 + 12) % 12 - 6) < 1; });
        g.shadowBlur = hit ? 18 : 0; g.shadowColor = '#ff3d9a';
        g.fillStyle = hit ? '#ff3d9a' : active ? 'rgba(255,61,154,0.7)' : n.end < t ? 'rgba(167,162,189,0.3)' : 'rgba(56,225,255,0.75)';
        g.beginPath(); g.roundRect(x, y(p) - 5, len, 10, 5); g.fill();
      }
      g.shadowBlur = 0;

      // singers: glowing trails, green where they sit on a semitone (within 20 cents)
      for (const s of trails) {
        let prev: [number, number] | null = null;
        g.lineCap = 'round'; g.lineWidth = 4;
        for (const [pt, m] of s.points) {
          if (m == null || pt < t - PAST) { prev = null; continue; }
          let mm = m;
          while (mm < lo) mm += 12;
          while (mm > lo + span) mm -= 12;
          const x = head + (pt - t) * pps, yy = y(mm);
          if (prev && Math.abs(prev[1] - yy) < laneH / 3) {
            const inTune = Math.abs(m - Math.round(m)) <= 0.2;
            g.strokeStyle = inTune ? '#3ddc97' : s.color;
            g.shadowBlur = reduce ? 0 : 12; g.shadowColor = g.strokeStyle;
            g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(x, yy); g.stroke();
          }
          prev = [x, yy];
        }
        g.shadowBlur = 0;
        const last = s.points[s.points.length - 1];
        if (last && last[1] != null && last[0] > t - 0.3) {
          let mm = last[1];
          while (mm < lo) mm += 12;
          while (mm > lo + span) mm -= 12;
          const yy = y(mm), cents = Math.round((last[1] - Math.round(last[1])) * 100);
          g.fillStyle = s.color; g.shadowBlur = reduce ? 0 : 20; g.shadowColor = s.color;
          g.beginPath(); g.arc(head, yy, 6, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
          if (trails.length === 1) {
            g.font = '800 14px ui-sans-serif, system-ui'; g.fillStyle = '#f6f4ff';
            g.fillText(`${noteLabel(last[1])} ${cents >= 0 ? '+' : '−'}${Math.abs(cents)}¢`, head + 12, Math.max(10, Math.min(laneH - 10, yy)));
          }
        }
      }
      // playhead
      const ph = g.createLinearGradient(0, 0, 0, laneH);
      ph.addColorStop(0, 'rgba(255,61,154,0)'); ph.addColorStop(0.5, 'rgba(246,244,255,0.9)'); ph.addColorStop(1, 'rgba(56,225,255,0)');
      g.fillStyle = ph; g.fillRect(head - 1, 0, 2, laneH);

      // spectrum: log-spaced bars 70 Hz – 6 kHz
      if (analyser && freq && specH) {
        analyser.getByteFrequencyData(freq);
        const top = laneH + 6, bars = Math.max(24, Math.floor(laneW / 9));
        const nyq = analyser.context.sampleRate / 2;
        const grad = g.createLinearGradient(0, 0, laneW, 0);
        grad.addColorStop(0, '#38e1ff'); grad.addColorStop(0.5, '#8b5cff'); grad.addColorStop(1, '#ff3d9a');
        g.fillStyle = grad;
        for (let b = 0; b < bars; b++) {
          const f0 = 70 * (6000 / 70) ** (b / bars), f1 = 70 * (6000 / 70) ** ((b + 1) / bars);
          const i0 = Math.floor((f0 / nyq) * freq.length), i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * freq.length));
          let v = 0;
          for (let i = i0; i < i1; i++) v = Math.max(v, freq[i] ?? 0);
          const bh = (v / 255) * specH;
          const bw = laneW / bars;
          g.beginPath(); g.roundRect(b * bw + 1, top + specH - bh, bw - 2, Math.max(2, bh), 2); g.fill();
        }
      }

      // level meters (one per singer), with peak hold
      const levels = getLevels();
      levels.forEach((l, i) => {
        const x = w - meterW + 6 + i * 8, mh = h - 4;
        const v = Math.max(0, Math.min(1, (l.db + 60) / 60));
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, 2, 5, mh);
        const mg = g.createLinearGradient(0, mh, 0, 0);
        mg.addColorStop(0, '#3ddc97'); mg.addColorStop(0.7, '#ffc94d'); mg.addColorStop(1, '#ff6b7d');
        g.fillStyle = mg; g.fillRect(x, 2 + mh * (1 - v), 5, mh * v);
        const key = `${i}`, pk = peaks.get(key), now = performance.now();
        if (!pk || l.db > pk.db || now - pk.at > 1200) peaks.set(key, { db: l.db, at: now });
        const pv = Math.max(0, Math.min(1, ((peaks.get(key)!.db) + 60) / 60));
        g.fillStyle = l.color; g.fillRect(x - 1, 2 + mh * (1 - pv), 7, 2);
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getTime, getTrails, notes, keyShift, analyser, getLevels]);
  return <canvas ref={canvas} className="h-full w-full" role="img" aria-label="Voice visualiser: your pitch, waveform and spectrum" />;
}
