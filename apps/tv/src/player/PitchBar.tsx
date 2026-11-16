import { Text, View } from 'react-native';

import { midiName, Note } from '../api';
import { colors, useScale } from '../theme';

const PAST = 1.5;     // seconds visible behind the playhead
const FUTURE = 5;     // seconds visible ahead of it

/**
 * Scrolling "note highway": the reference melody (shifted by the key change)
 * flows right-to-left past a playhead. Phone-mic pitch will draw on top of this.
 */
export function PitchBar({ notes, t, keyShift, range }: { notes: Note[]; t: number; keyShift: number; range: { min: number; max: number } }) {
  const s = useScale();
  const width = s(1728);
  const height = s(190);
  const headX = width * (PAST / (PAST + FUTURE));
  const pxPerSec = width / (PAST + FUTURE);
  const lo = range.min + keyShift - 2;
  const hi = range.max + keyShift + 2;
  const rowH = height / Math.max(1, hi - lo + 1);
  const y = (p: number) => height - (p - lo + 1) * rowH;

  const visible = notes.filter((n) => n.end > t - PAST && n.start < t + FUTURE);

  return (
    <View style={{ width, height, borderRadius: s(18), backgroundColor: 'rgba(20,18,31,0.72)', borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      {[0, 12].map((o) => {
        const c = Math.ceil(lo / 12) * 12 + o;
        return c <= hi ? (
          <View key={o} style={{ position: 'absolute', left: 0, right: 0, top: y(c) + rowH / 2, height: 1, backgroundColor: colors.border }}>
            <Text style={{ position: 'absolute', left: s(10), top: -s(22), color: colors.dim, fontSize: s(16) }}>{midiName(c)}</Text>
          </View>
        ) : null;
      })}
      {visible.map((n) => {
        const p = n.pitch + keyShift;
        const x = headX + (n.start - t) * pxPerSec;
        const w = Math.max(s(6), (n.end - n.start) * pxPerSec - s(3));
        const active = n.start <= t && t < n.end;
        const past = n.end <= t;
        return (
          <View
            key={`${n.start}-${n.pitch}`}
            style={{
              position: 'absolute', left: x, top: y(p) + rowH * 0.15, width: w, height: Math.max(s(8), rowH * 0.7),
              borderRadius: s(8),
              backgroundColor: active ? colors.pink : past ? 'rgba(161,157,184,0.35)' : colors.cyan,
              shadowColor: colors.pink, shadowOpacity: active ? 0.9 : 0, shadowRadius: s(14),
            }}
          />
        );
      })}
      <View style={{ position: 'absolute', left: headX - s(2), top: 0, bottom: 0, width: s(4), backgroundColor: colors.text, opacity: 0.9 }} />
    </View>
  );
}
