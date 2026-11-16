import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { installWebSpatialNav } from './src/focus/webSpatialNav';
import { NavProvider, useNav } from './src/nav';
import { HomeScreen } from './src/screens/HomeScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { SongScreen } from './src/screens/SongScreen';
import { colors } from './src/theme';

function Screens() {
  const { route } = useNav();
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'search':
      return <SearchScreen />;
    case 'song':
      return <SongScreen key={route.bundleId ?? route.song?.id} bundleId={route.bundleId} song={route.song} />;
    case 'player':
      return <PlayerScreen key={route.bundleId} {...route} />;
  }
}

export default function App() {
  useEffect(() => (Platform.OS === 'web' ? installWebSpatialNav() : undefined), []);
  return (
    <NavProvider>
      <View style={styles.root}>
        <StatusBar hidden />
        <Screens />
      </View>
    </NavProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
