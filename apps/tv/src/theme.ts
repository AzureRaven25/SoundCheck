import { useWindowDimensions } from 'react-native';

export const colors = {
  bg: '#08070F',
  surface: '#14121F',
  surfaceHi: '#1F1C30',
  border: '#2C2842',
  text: '#F6F4FF',
  muted: '#A19DB8',
  dim: '#6A6684',
  pink: '#FF3D9A',
  cyan: '#38E1FF',
  violet: '#8B5CFF',
  gold: '#FFC94D',
  success: '#3DDC97',
};

export const gradients = {
  brand: [colors.pink, colors.violet] as const,
  wipe: [colors.cyan, colors.pink] as const,
};

/** Designs are authored at 1920x1080. On a Fire TV (960x540 dp) everything scales by 0.5. */
export function useScale() {
  const { width, height } = useWindowDimensions();
  const k = Math.min(width / 1920, height / 1080);
  return (px: number) => Math.round(px * k * 100) / 100;
}

export const fontFamily = undefined; // platform default (Roboto on Fire TV, SF on Apple TV, system-ui on web)
