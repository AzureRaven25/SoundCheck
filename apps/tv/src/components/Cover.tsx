import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Image, StyleProp, Text, View, ViewStyle } from 'react-native';

import { colors } from '../theme';

const PALETTES: [string, string][] = [
  [colors.pink, colors.violet],
  [colors.violet, colors.cyan],
  [colors.cyan, '#3D7BFF'],
  ['#FF8A3D', colors.pink],
  [colors.gold, '#FF5E5E'],
  [colors.success, colors.cyan],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Album art, or a generated gradient tile with initials when there's no art. */
export function Cover({
  uri, title, size, radius = 12, style, blur,
}: { uri: string | null | undefined; title: string; size: number | '100%'; radius?: number; style?: StyleProp<ViewStyle>; blur?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const box: ViewStyle = { width: size, height: size, borderRadius: radius, overflow: 'hidden' };

  if (uri && !failed) {
    return (
      <View style={[box, { backgroundColor: colors.surfaceHi }, style]}>
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} blurRadius={blur} onError={() => setFailed(true)} />
      </View>
    );
  }
  const [a, b] = PALETTES[hash(title) % PALETTES.length];
  const initials = title
    .split(/\s+/)
    .filter((w) => /\w/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const fontSize = typeof size === 'number' ? size * 0.32 : 64;
  return (
    <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[box, { alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize, fontWeight: '800', letterSpacing: -1 }}>{initials || '♪'}</Text>
    </LinearGradient>
  );
}
