import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { api, formatDuration, LibraryItem, midiName, Song, transposeKey } from '../api';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { Cover } from '../components/Cover';
import { useNav } from '../nav';
import { colors, useScale } from '../theme';

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const s = useScale();
  return (
    <View style={{ marginRight: s(48) }}>
      <Text style={{ color: colors.dim, fontSize: s(20), fontWeight: '700', letterSpacing: 2, marginBottom: s(10) }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Button label="−" compact onPress={onMinus} />
        <Text style={{ color: colors.text, fontSize: s(32), fontWeight: '800', minWidth: s(150), textAlign: 'center' }}>{value}</Text>
        <Button label="+" compact onPress={onPlus} />
      </View>
    </View>
  );
}

export function SongScreen({ bundleId, song }: { bundleId?: string; song?: Song }) {
  const s = useScale();
  const nav = useNav();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [keyShift, setKeyShift] = useState(0);
  const [guide, setGuide] = useState(0);
  const [wishlisted, setWishlisted] = useState(false);

  useEffect(() => {
    if (bundleId) api.libraryItem(bundleId).then(setItem).catch(() => {});
    if (song && !bundleId) api.wishlist().then((w) => setWishlisted(w.some((x) => x.id === song.id))).catch(() => {});
  }, [bundleId, song]);

  const title = item?.title ?? song?.title ?? '';
  const artist = item?.artist ?? song?.artist ?? '';
  const cover = item?.cover_url ?? song?.cover_url ?? null;
  const year = item?.year ?? song?.year;
  const duration = item?.duration_s ?? (song?.length_ms ? song.length_ms / 1000 : null);
  const range = item?.vocal_range;

  const facts = [
    year,
    duration && formatDuration(duration),
    item?.key && `Key of ${transposeKey(item.key, keyShift)}`,
    item?.tempo_bpm && `${Math.round(item.tempo_bpm)} BPM`,
  ].filter(Boolean);

  return (
    <View style={{ flex: 1 }}>
      <Backdrop uri={cover} strength={0.7} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: s(120) }}>
        <Cover uri={cover} title={title || '♪'} size={s(520)} radius={s(28)} />
        <View style={{ flex: 1, marginLeft: s(80) }}>
          <Text numberOfLines={2} style={{ color: colors.text, fontSize: s(76), fontWeight: '900', letterSpacing: -2 }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: s(40), fontWeight: '600', marginTop: s(8) }}>{artist}</Text>
          <Text style={{ color: colors.cyan, fontSize: s(26), fontWeight: '700', marginTop: s(20) }}>{facts.join('  ·  ')}</Text>
          {range ? (
            <Text style={{ color: colors.muted, fontSize: s(24), marginTop: s(10) }}>
              Vocal range {midiName(range.low + keyShift)} – {midiName(range.high + keyShift)}
              {item?.has_lyrics ? '' : '  ·  no synced lyrics found'}
            </Text>
          ) : null}

          {bundleId ? (
            <>
              <View style={{ flexDirection: 'row', marginTop: s(48) }}>
                <Button
                  icon="🎤" label="Sing" primary autoFocus
                  onPress={() => nav.push({ name: 'player', bundleId, mode: 'karaoke', keyShift, guide })}
                />
                <View style={{ width: s(24) }} />
                <Button icon="▶" label="Listen to original" onPress={() => nav.push({ name: 'player', bundleId, mode: 'original', keyShift: 0, guide: 1 })} />
              </View>
              <View style={{ flexDirection: 'row', marginTop: s(44) }}>
                <Stepper
                  label="KEY" value={keyShift === 0 ? 'Original' : `${keyShift > 0 ? '+' : ''}${keyShift}`}
                  onMinus={() => setKeyShift((k) => Math.max(-6, k - 1))} onPlus={() => setKeyShift((k) => Math.min(6, k + 1))}
                />
                <Stepper
                  label="GUIDE VOCAL" value={guide === 0 ? 'Off' : `${Math.round(guide * 100)}%`}
                  onMinus={() => setGuide((g) => Math.max(0, +(g - 0.1).toFixed(1)))} onPlus={() => setGuide((g) => Math.min(1, +(g + 0.1).toFixed(1)))}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={{ color: colors.gold, fontSize: s(28), fontWeight: '700', marginTop: s(40) }}>Not in your library yet</Text>
              <Text style={{ color: colors.muted, fontSize: s(24), marginTop: s(8), maxWidth: s(900) }}>
                Add a copy you own to your music folder and run the pipeline to make it singable.
              </Text>
              <View style={{ flexDirection: 'row', marginTop: s(36) }}>
                <Button
                  icon={wishlisted ? '✓' : '+'} label={wishlisted ? 'On your wishlist' : 'Add to wishlist'} primary={!wishlisted} autoFocus
                  onPress={() => {
                    if (!song) return;
                    const next = !wishlisted;
                    setWishlisted(next);
                    api.setWishlisted(song.id, next).catch(() => setWishlisted(!next));
                  }}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}
