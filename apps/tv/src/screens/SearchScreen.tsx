import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';

import { api, formatDuration, Song } from '../api';
import { Cover } from '../components/Cover';
import { Focusable } from '../components/Focusable';
import { useNav } from '../nav';
import { colors, useScale } from '../theme';

const KEYS = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');
const COLS = 6;
// Remembered while the app runs, so Back from a song returns to the same results.
let lastQuery = '';

function Key({ label, onPress, wide, autoFocus }: { label: string; onPress: () => void; wide?: boolean; autoFocus?: boolean }) {
  const s = useScale();
  const size = s(76);
  return (
    <View style={{ margin: s(5) }}>
      <Focusable onPress={onPress} radius={s(14)} zoom={1.12} autoFocus={autoFocus} accessibilityLabel={label}>
        {(f) => (
          <View style={{ width: wide ? size * 3 + s(20) : size, height: size, borderRadius: s(12), alignItems: 'center', justifyContent: 'center', backgroundColor: f ? colors.pink : colors.surfaceHi }}>
            <Text style={{ color: colors.text, fontSize: wide ? s(24) : s(32), fontWeight: '700' }}>{label}</Text>
          </View>
        )}
      </Focusable>
    </View>
  );
}

function ResultRow({ song, onPress }: { song: Song; onPress: () => void }) {
  const s = useScale();
  return (
    <View style={{ marginBottom: s(10) }}>
      <Focusable onPress={onPress} radius={s(16)} zoom={1.02} accessibilityLabel={`${song.title} by ${song.artist}`}>
        {(f) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: s(12), borderRadius: s(14), backgroundColor: f ? colors.surfaceHi : 'transparent' }}>
            <Cover uri={song.cover_url} title={song.title} size={s(88)} radius={s(10)} />
            <View style={{ flex: 1, marginLeft: s(22) }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: s(28), fontWeight: '700' }}>{song.title}</Text>
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: s(22), marginTop: s(4) }}>
                {[song.artist, song.year, song.length_ms ? formatDuration(song.length_ms / 1000) : null].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
            {song.bundle_id ? (
              <View style={{ backgroundColor: colors.pink, borderRadius: s(8), paddingHorizontal: s(12), paddingVertical: s(6), marginRight: s(12) }}>
                <Text style={{ color: '#fff', fontSize: s(18), fontWeight: '800' }}>♪ SING</Text>
              </View>
            ) : null}
          </View>
        )}
      </Focusable>
    </View>
  );
}

export function SearchScreen() {
  const s = useScale();
  const nav = useNav();
  const [query, setQuery] = useState(lastQuery);
  const [results, setResults] = useState<Song[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const reqId = useRef(0);

  // Physical keyboard typing in the browser preview.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 && /[\p{L}\p{N} '&-]/u.test(e.key)) {
        setQuery((q) => q + e.key.toLowerCase());
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        setQuery((q) => q.slice(0, -1));
        e.preventDefault(); // keeps nav's Backspace-to-go-back from firing while typing
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    lastQuery = query;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const id = ++reqId.current;
    setStatus('loading');
    const timer = setTimeout(() => {
      api.search(q, 30)
        .then((r) => {
          if (id === reqId.current) {
            setResults(r);
            setStatus('done');
          }
        })
        .catch(() => id === reqId.current && setStatus('error'));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const rows: string[][] = [];
  for (let i = 0; i < KEYS.length; i += COLS) rows.push(KEYS.slice(i, i + COLS));

  return (
    <View style={{ flex: 1, flexDirection: 'row', paddingTop: s(64), paddingHorizontal: s(96), backgroundColor: colors.bg }}>
      <View style={{ width: s(560) }}>
        <Text style={{ color: colors.dim, fontSize: s(24), fontWeight: '700', letterSpacing: 2 }}>SEARCH</Text>
        <View style={{ height: s(84), justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: colors.pink, marginTop: s(8), marginBottom: s(28) }}>
          <Text numberOfLines={1} style={{ color: query ? colors.text : colors.dim, fontSize: s(44), fontWeight: '800' }}>
            {query || 'Song or artist'}
            <Text style={{ color: colors.pink }}>|</Text>
          </Text>
        </View>
        {rows.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row' }}>
            {row.map((k, c) => (
              <Key key={k} label={k.toUpperCase()} autoFocus={r === 0 && c === 0} onPress={() => setQuery((q) => q + k)} />
            ))}
          </View>
        ))}
        <View style={{ flexDirection: 'row' }}>
          <Key label="Space" wide onPress={() => setQuery((q) => (q && !q.endsWith(' ') ? q + ' ' : q))} />
          <Key label="⌫" onPress={() => setQuery((q) => q.slice(0, -1))} />
          <Key label="Clear" wide onPress={() => setQuery('')} />
        </View>
      </View>

      <View style={{ flex: 1, marginLeft: s(72) }}>
        <Text style={{ color: colors.dim, fontSize: s(24), fontWeight: '700', letterSpacing: 2, marginBottom: s(20) }}>
          {status === 'loading' ? 'SEARCHING…' : status === 'error' ? 'SEARCH FAILED, IS THE SERVER RUNNING?' : results.length ? `${results.length} RESULTS` : query ? 'NO MATCHES' : 'TYPE TO SEARCH EVERY SONG'}
        </Text>
        <ScrollView contentContainerStyle={{ paddingBottom: s(80), paddingRight: s(24) }}>
          {results.map((song) => (
            <ResultRow
              key={song.id}
              song={song}
              onPress={() => nav.push(song.bundle_id ? { name: 'song', bundleId: song.bundle_id } : { name: 'song', song })}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
