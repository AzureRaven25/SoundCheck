import { Text, View } from 'react-native';

import { colors, useScale } from '../theme';
import { Cover } from './Cover';
import { Focusable } from './Focusable';

export type CardData = {
  key: string;
  title: string;
  artist: string | null;
  cover: string | null;
  singable: boolean;
  subtitle?: string | null;
};

export function SongCard({ data, onPress, onFocus, autoFocus }: { data: CardData; onPress: () => void; onFocus?: () => void; autoFocus?: boolean }) {
  const s = useScale();
  const size = s(260);
  return (
    <View style={{ width: size + s(6), marginRight: s(28) }}>
      <Focusable onPress={onPress} onFocus={onFocus} autoFocus={autoFocus} radius={s(18)} zoom={1.08} accessibilityLabel={`${data.title} by ${data.artist ?? 'unknown'}`}>
        <View>
          <Cover uri={data.cover} title={data.title} size={size} radius={s(15)} />
          {data.singable && (
            <View style={{ position: 'absolute', top: s(10), left: s(10), backgroundColor: colors.pink, borderRadius: s(8), paddingHorizontal: s(10), paddingVertical: s(4) }}>
              <Text style={{ color: '#fff', fontSize: s(17), fontWeight: '800' }}>♪ SING</Text>
            </View>
          )}
        </View>
      </Focusable>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: s(24), fontWeight: '700', marginTop: s(14) }}>{data.title}</Text>
      <Text numberOfLines={1} style={{ color: colors.muted, fontSize: s(20), marginTop: s(2) }}>
        {data.artist ?? 'Unknown artist'}
        {data.subtitle ? `  ·  ${data.subtitle}` : ''}
      </Text>
    </View>
  );
}
