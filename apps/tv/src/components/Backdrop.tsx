import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View } from 'react-native';

import { colors } from '../theme';

/** Full-screen blurred album art fading into the background colour. */
export function Backdrop({ uri, strength = 0.55 }: { uri: string | null | undefined; strength?: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['#1A0F2E', colors.bg]} style={StyleSheet.absoluteFill} />
      {uri ? <Image source={{ uri }} blurRadius={60} style={[StyleSheet.absoluteFill, { opacity: strength }]} resizeMode="cover" /> : null}
      <LinearGradient colors={['rgba(8,7,15,0.15)', 'rgba(8,7,15,0.75)', colors.bg]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(8,7,15,0.85)', 'rgba(8,7,15,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}
