import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { api, formatDuration, LibraryItem, Lyrics, Melody, transposeKey } from '../api';
import { createEngine, KaraokeEngine, PlayMode } from '../audio/engine';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { useNav } from '../nav';
import { LyricsView } from '../player/LyricsView';
import { PitchBar } from '../player/PitchBar';
import { colors, useScale } from '../theme';

type Props = { bundleId: string; mode: PlayMode; keyShift: number; guide: number };

export function PlayerScreen(props: Props) {
  const s = useScale();
  const nav = useNav();
  const engine = useRef<KaraokeEngine | null>(null);
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [melody, setMelody] = useState<Melody | null>(null);
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [t, setT] = useState(0);
  const [mode, setMode] = useState<PlayMode>(props.mode);
  const [keyShift, setKeyShift] = useState(props.keyShift);
  const [guide, setGuide] = useState(props.guide);

  useEffect(() => {
    const { bundleId } = props;
    api.libraryItem(bundleId).then(setItem).catch(() => {});
    api.lyrics(bundleId).then(setLyrics).catch(() => setLyrics({ source: 'none', lines: [] }));
    api.melody(bundleId).then(setMelody).catch(() => setMelody({ hop: 0.01, contour: [], notes: [] }));

    const e = createEngine();
    engine.current = e;
    let cancelled = false;
    e.onEnded(() => {
      setPlaying(false);
      setEnded(true);
    });
    e.load(bundleId, setLoading)
      .then(() => {
        if (cancelled) return;
        e.setMode(props.mode);
        e.setGuide(props.guide);
        e.setKeyShift(props.keyShift);
        setReady(true);
        e.play();
        setPlaying(true);
      })
      .catch((err) => !cancelled && setError(String(err?.message ?? err)));
    return () => {
      cancelled = true;
      e.dispose();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bundleId]);

  // Drive lyrics + pitch bar from the audio clock.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const tick = () => {
      if (engine.current) setT(engine.current.currentTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  const e = engine.current;
  const toggle = () => {
    if (!e) return;
    if (e.isPlaying()) e.pause();
    else {
      setEnded(false);
      e.play();
    }
    setPlaying(e.isPlaying());
  };
  const restart = () => {
    if (!e) return;
    e.seek(0);
    setEnded(false);
    e.play();
    setPlaying(true);
  };
  const skip = (d: number) => e?.seek(Math.max(0, e.currentTime() + d));
  const changeKey = (d: number) => {
    const k = Math.max(-6, Math.min(6, keyShift + d));
    setKeyShift(k);
    e?.setKeyShift(k);
  };
  const changeGuide = (d: number) => {
    const g = Math.max(0, Math.min(1, +(guide + d).toFixed(1)));
    setGuide(g);
    e?.setGuide(g);
  };
  const switchMode = () => {
    const m: PlayMode = mode === 'karaoke' ? 'original' : 'karaoke';
    setMode(m);
    e?.setMode(m);
  };

  const duration = e?.duration() ?? item?.duration_s ?? 0;
  const notes = melody?.notes ?? [];
  const range = item?.vocal_range ?? (notes.length
    ? { min: Math.min(...notes.map((n) => n.pitch)), max: Math.max(...notes.map((n) => n.pitch)) }
    : { min: 55, max: 72 });

  return (
    <View style={{ flex: 1 }}>
      <Backdrop uri={item?.cover_url} strength={0.4} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: s(96), paddingTop: s(48) }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: s(34), fontWeight: '800' }}>{item?.title ?? ''}</Text>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: s(24), marginTop: s(4) }}>{item?.artist ?? ''}</Text>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Chip label={mode === 'karaoke' ? 'KARAOKE' : 'ORIGINAL'} color={mode === 'karaoke' ? colors.pink : colors.violet} />
          {item?.key ? <Chip label={`KEY ${transposeKey(item.key, keyShift)?.toUpperCase()}`} color={keyShift ? colors.gold : colors.surfaceHi} /> : null}
        </View>
      </View>

      {mode === 'karaoke' ? (
        <View style={{ alignItems: 'center', marginTop: s(36) }}>
          <PitchBar notes={notes} t={t} keyShift={keyShift} range={range} />
        </View>
      ) : (
        <View style={{ height: s(226) }} />
      )}

      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: s(96) }}>
        {error ? (
          <Text style={{ color: colors.gold, fontSize: s(32), textAlign: 'center' }}>Couldn't load this song: {error}</Text>
        ) : !ready ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontSize: s(36), fontWeight: '700' }}>Warming up the band…</Text>
            <View style={{ width: s(600), height: s(8), borderRadius: s(4), backgroundColor: colors.surfaceHi, marginTop: s(28), overflow: 'hidden' }}>
              <View style={{ width: `${Math.round(loading * 100)}%`, height: '100%', backgroundColor: colors.pink }} />
            </View>
          </View>
        ) : ended ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: s(84), fontWeight: '900', letterSpacing: -2 }}>That's a wrap!</Text>
            <Text style={{ color: colors.muted, fontSize: s(30), marginTop: s(12) }}>Scoring arrives with phone mics.</Text>
            <View style={{ flexDirection: 'row', marginTop: s(40) }}>
              <Button icon="↺" label="Sing again" primary autoFocus onPress={restart} />
              <View style={{ width: s(24) }} />
              <Button label="Back to song" onPress={() => nav.back()} />
            </View>
          </View>
        ) : lyrics && lyrics.lines.length ? (
          <LyricsView lines={lyrics.lines} notes={notes} t={t} />
        ) : (
          <Text style={{ color: colors.dim, fontSize: s(40), textAlign: 'center' }}>{lyrics ? 'No synced lyrics for this song' : ''}</Text>
        )}
      </View>

      <LinearGradient colors={['rgba(8,7,15,0)', 'rgba(8,7,15,0.9)']} style={{ paddingHorizontal: s(96), paddingBottom: s(48), paddingTop: s(24) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: s(24) }}>
          <Text style={{ color: colors.muted, fontSize: s(22), width: s(90) }}>{formatDuration(t)}</Text>
          <View style={{ flex: 1, height: s(8), borderRadius: s(4), backgroundColor: colors.surfaceHi, overflow: 'hidden' }}>
            <LinearGradient colors={[colors.cyan, colors.pink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${duration ? Math.min(100, (t / duration) * 100) : 0}%`, height: '100%' }} />
          </View>
          <Text style={{ color: colors.muted, fontSize: s(22), width: s(90), textAlign: 'right' }}>{formatDuration(duration)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button icon={playing ? '❚❚' : '▶'} label={playing ? 'Pause' : 'Play'} compact autoFocus={ready && !ended} onPress={toggle} disabled={!ready} />
          <Gap />
          <Button icon="⏪" label="10s" compact onPress={() => skip(-10)} disabled={!ready} />
          <Gap />
          <Button icon="⏩" label="10s" compact onPress={() => skip(10)} disabled={!ready} />
          <Gap />
          <Button icon="⇄" label={mode === 'karaoke' ? 'Hear original' : 'Back to karaoke'} compact onPress={switchMode} disabled={!ready} />
          <Divider />
          <Label text="KEY" />
          <Button label="−" compact onPress={() => changeKey(-1)} disabled={!ready || !e?.supportsKeyShift || mode !== 'karaoke'} />
          <Value text={keyShift === 0 ? '0' : `${keyShift > 0 ? '+' : ''}${keyShift}`} />
          <Button label="+" compact onPress={() => changeKey(1)} disabled={!ready || !e?.supportsKeyShift || mode !== 'karaoke'} />
          <Divider />
          <Label text="GUIDE" />
          <Button label="−" compact onPress={() => changeGuide(-0.1)} disabled={!ready || mode !== 'karaoke'} />
          <Value text={guide === 0 ? 'Off' : `${Math.round(guide * 100)}%`} />
          <Button label="+" compact onPress={() => changeGuide(0.1)} disabled={!ready || mode !== 'karaoke'} />
        </View>
      </LinearGradient>
    </View>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  const s = useScale();
  return (
    <View style={{ backgroundColor: color, borderRadius: s(10), paddingHorizontal: s(16), paddingVertical: s(8), marginLeft: s(14) }}>
      <Text style={{ color: '#fff', fontSize: s(20), fontWeight: '800', letterSpacing: 1 }}>{label}</Text>
    </View>
  );
}
const Gap = () => <View style={{ width: useScale()(16) }} />;
const Divider = () => {
  const s = useScale();
  return <View style={{ width: 2, height: s(44), backgroundColor: colors.border, marginHorizontal: s(28) }} />;
};
const Label = ({ text }: { text: string }) => {
  const s = useScale();
  return <Text style={{ color: colors.dim, fontSize: s(20), fontWeight: '800', letterSpacing: 2, marginRight: s(14) }}>{text}</Text>;
};
const Value = ({ text }: { text: string }) => {
  const s = useScale();
  return <Text style={{ color: colors.text, fontSize: s(28), fontWeight: '800', minWidth: s(90), textAlign: 'center' }}>{text}</Text>;
};
