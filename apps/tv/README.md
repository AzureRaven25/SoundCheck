# KaraokeApp: TV app

React Native + Expo with [`react-native-tvos`](https://github.com/react-native-tvos/react-native-tvos). One codebase runs on **Fire TV (Fire OS)**, **Apple TV**, and in a **web browser**, which is the quickest way to iterate on the UI.

## Screens

| Screen | What it does |
|---|---|
| **Home** | A pinned hero shows the focused song over blurred album art. Rows below: *Ready to sing* (your library), *Your wishlist*, *Classics* (from the full catalog). |
| **Search** | A remote-friendly on-screen keyboard (a physical keyboard works too). Results come from the whole catalog and are updated while you type. Typos are handled. Songs you can sing show a ♪ SING badge. |
| **Song** | Album art and details (year, key, tempo, vocal range). **Sing** or **Listen to original**, with key (±6 semitones) and guide-vocal level set before you start. Songs not in your library get *Add to wishlist* instead. |
| **Player** | Scrolling pitch bar showing the reference melody (shifted with the key), the current lyric line with a colour wipe that ends with the singer, the next line, and a 3-2-1 countdown after instrumental breaks. Controls: play/pause, ±10 s, switch between original and karaoke, live key change, live guide-vocal level. |

Remote mapping: D-pad = arrows, Select = Enter, Back = Escape (or Backspace).

## Run it in a browser

You need the API running (see [services/api](../../services/api/README.md)), then:

```bash
cd apps/tv
npm install
npx expo start --web
```

Open <http://localhost:8081>. Use the arrow keys, Enter and Escape like a remote. Browser playback uses Web Audio + SoundTouch, so **key change works live** in the preview.

## Run it on your Fire TV

Building for Fire TV needs the Android SDK, which isn't installed yet:

1. Install Android Studio (or `brew install --cask android-commandlinetools`) and set `ANDROID_HOME`.
2. On the Fire TV, go to *Settings → My Fire TV → Developer options* and turn on **ADB debugging**. Note its IP address under *About → Network*.
3. Find your Mac's LAN IP (`ipconfig getifaddr en0`). Then:

   ```bash
   adb connect <fire-tv-ip>:5555
   cd apps/tv
   EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:8000 npm run prebuild:tv
   EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:8000 npx expo run:android
   ```

The API listens on all interfaces (`0.0.0.0:8000`) so the TV can reach it over Wi-Fi.

On TV, playback currently uses `expo-audio`, with synced instrumental and vocal players. **Key change is disabled on TV** until the native audio engine lands (Oboe + Signalsmith Stretch, plan §5.3). Everything else works the same.

## Code map

```
App.tsx                      screen switcher + web arrow-key navigation
src/api.ts                   API client and types
src/nav.tsx                  tiny navigation stack with Back handling (remote Back, Escape)
src/focus/webSpatialNav.ts   D-pad focus movement for the browser (TVs do this natively)
src/audio/engine.ts          playback engine interface
src/audio/createEngine.web.ts     Web Audio + SoundTouch (key change, tempo, guide vocal)
src/audio/createEngine.native.ts  expo-audio (interim TV engine)
src/player/                  lyrics view, pitch bar, timing helpers
src/screens/                 Home, Search, Song, Player
src/components/              focusable buttons/cards, cover art, shelves, backdrop
```

`soundtouchjs` is LGPL-2.1 and only used in the web build.
