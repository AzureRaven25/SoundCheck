import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { LyricLine, Note } from '../api';
import { colors, useScale } from '../theme';
import { countdown, currentLineIndex, sungEnd } from './timing';

function fontSizeFor(text: string, base: number) {
  // Keep long lines on one row: shrink proportionally past ~28 characters.
  return Math.min(base, (base * 28) / Math.max(28, text.length));
}

/** Current line with a left-to-right colour wipe; the next line waits underneath. */
export function LyricsView({ lines, notes, t }: { lines: LyricLine[]; notes: Note[]; t: number }) {
  const s = useScale();
  const [lineWidth, setLineWidth] = useState(0);
  const i = currentLineIndex(lines, t);
  const cur = i >= 0 ? lines[i] : null;
  const showCur = cur && cur.text.trim() && t < cur.end;
  const next = lines.slice(i + 1).find((l) => l.text.trim()) ?? null;
  const cd = countdown(lines, t);

  let progress = 0;
  if (cur && showCur) {
    const end = sungEnd(cur, notes);
    progress = Math.max(0, Math.min(1, (t - cur.start) / Math.max(0.2, end - cur.start)));
  }
  const big = s(84);
  const curSize = cur ? fontSizeFor(cur.text, big) : big;
  const textStyle = { fontSize: curSize, fontWeight: '800' as const, letterSpacing: -0.5 };

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: s(300) }}>
      <View style={{ height: s(40), flexDirection: 'row', marginBottom: s(18) }}>
        {cd != null &&
          [3, 2, 1].map((n) => (
            <View
              key={n}
              style={{
                width: s(22), height: s(22), borderRadius: s(11), marginHorizontal: s(10),
                backgroundColor: cd > n - 1 ? colors.pink : colors.border,
              }}
            />
          ))}
      </View>

      {showCur ? (
        <View onLayout={(e) => setLineWidth(e.nativeEvent.layout.width)}>
          <Text numberOfLines={1} style={[textStyle, { color: colors.text }]}>{cur!.text}</Text>
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: lineWidth * progress, overflow: 'hidden' }}>
            <Text numberOfLines={1} style={[textStyle, { color: colors.cyan, width: lineWidth }]}>{cur!.text}</Text>
          </View>
          <LinearGradient
            colors={[colors.cyan, colors.pink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: s(6), borderRadius: s(3), width: lineWidth * progress, marginTop: s(6) }}
          />
        </View>
      ) : (
        <Text style={[textStyle, { color: colors.dim, fontSize: s(48) }]}>{i < 0 && next ? 'Get ready…' : '♪'}</Text>
      )}

      <Text numberOfLines={1} style={{ color: colors.muted, fontSize: next ? fontSizeFor(next.text, s(52)) : s(52), fontWeight: '600', marginTop: s(36), opacity: 0.85 }}>
        {next && next !== cur ? next.text : ' '}
      </Text>
    </View>
  );
}
