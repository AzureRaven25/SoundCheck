import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleProp, ViewStyle } from 'react-native';

import { colors } from '../theme';

type Props = {
  children: ReactNode | ((focused: boolean) => ReactNode);
  onPress?: () => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  focusedStyle?: StyleProp<ViewStyle>;
  /** How much the item grows when focused (TV convention: focused item pops forward). */
  zoom?: number;
  radius?: number;
  accessibilityLabel?: string;
  disabled?: boolean;
};

/**
 * Remote-friendly button. Works with the Fire TV / Apple TV focus engine on
 * device and with arrow keys + Enter in the browser preview.
 */
export function Focusable({
  children, onPress, onFocus, autoFocus, style, focusedStyle, zoom = 1.06, radius = 16, accessibilityLabel, disabled,
}: Props) {
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const ref = useRef<any>(null);

  useEffect(() => {
    if (autoFocus && Platform.OS === 'web') {
      const id = setTimeout(() => ref.current?.focus?.(), 50);
      return () => clearTimeout(id);
    }
  }, [autoFocus]);

  useEffect(() => {
    Animated.spring(scale, { toValue: focused ? zoom : 1, useNativeDriver: Platform.OS !== 'web', friction: 7, tension: 120 }).start();
  }, [focused, zoom, scale]);

  const webProps =
    Platform.OS === 'web'
      ? ({ dataSet: { tvFocusable: 'true' }, role: 'button' } as Record<string, unknown>)
      : {};

  return (
    <Pressable
      ref={ref}
      {...webProps}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hasTVPreferredFocus={autoFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.(); // web scrolling into view is handled by webSpatialNav
      }}
      onBlur={() => setFocused(false)}
      style={{ outlineStyle: 'none' } as unknown as ViewStyle /* web: we draw our own focus ring */}
    >
      <Animated.View
        style={[
          { borderRadius: radius, borderWidth: 3, borderColor: 'transparent', transform: [{ scale }] },
          style,
          focused && {
            borderColor: colors.text,
            shadowColor: colors.pink,
            shadowOpacity: 0.7,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 0 },
            elevation: 12,
          },
          focused && focusedStyle,
          disabled && { opacity: 0.4 },
        ]}
      >
        {typeof children === 'function' ? children(focused) : children}
      </Animated.View>
    </Pressable>
  );
}
