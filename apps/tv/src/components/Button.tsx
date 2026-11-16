import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';

import { colors, useScale } from '../theme';
import { Focusable } from './Focusable';

type Props = {
  label: string;
  icon?: string;
  onPress: () => void;
  primary?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onFocus?: () => void;
};

export function Button({ label, icon, onPress, primary, autoFocus, disabled, compact, onFocus }: Props) {
  const s = useScale();
  const padH = compact ? s(26) : s(40);
  const padV = compact ? s(14) : s(20);
  const fontSize = compact ? s(24) : s(30);
  return (
    <Focusable onPress={onPress} autoFocus={autoFocus} disabled={disabled} radius={s(40)} zoom={1.08} onFocus={onFocus} accessibilityLabel={label}>
      {(focused) => {
        const content = (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: padH, paddingVertical: padV }}>
            {icon ? <Text style={{ fontSize, color: focused || primary ? '#fff' : colors.text, marginRight: label ? s(12) : 0 }}>{icon}</Text> : null}
            {label ? <Text style={{ fontSize, fontWeight: '800', color: focused || primary ? '#fff' : colors.text }}>{label}</Text> : null}
          </View>
        );
        return primary || focused ? (
          <LinearGradient colors={[colors.pink, colors.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: s(40) }}>
            {content}
          </LinearGradient>
        ) : (
          <View style={{ borderRadius: s(40), backgroundColor: colors.surfaceHi }}>{content}</View>
        );
      }}
    </Focusable>
  );
}
