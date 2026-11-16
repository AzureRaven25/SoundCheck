import { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { colors, useScale } from '../theme';

/** A titled horizontal row of cards (the standard TV "shelf"). */
export function Shelf({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const s = useScale();
  return (
    <View style={{ marginBottom: s(44) }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: s(96), marginBottom: s(18) }}>
        <Text style={{ color: colors.text, fontSize: s(32), fontWeight: '800' }}>{title}</Text>
        {hint ? <Text style={{ color: colors.dim, fontSize: s(22), marginLeft: s(16) }}>{hint}</Text> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: s(96), paddingVertical: s(16) }}>
        {children}
      </ScrollView>
    </View>
  );
}
