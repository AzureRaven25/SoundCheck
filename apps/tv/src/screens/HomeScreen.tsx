import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { api, formatDuration, LibraryItem, Song } from '../api';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { Shelf } from '../components/Shelf';
import { CardData, SongCard } from '../components/SongCard';
import { useNav } from '../nav';
import { colors, useScale } from '../theme';

type Hero = { title: string; artist: string | null; cover: string | null; line: string };

function libraryCard(i: LibraryItem): CardData {
  return { key: `lib-${i.bundle_id}`, title: i.title, artist: i.artist, cover: i.cover_url, singable: true, subtitle: i.key };
}
function songCard(s: Song): CardData {
  return { key: `song-${s.id}`, title: s.title, artist: s.artist, cover: s.cover_url, singable: !!s.bundle_id, subtitle: s.year ? String(s.year) : null };
}

export function HomeScreen() {
  const s = useScale();
  const nav = useNav();
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [wishlist, setWishlist] = useState<Song[]>([]);
  const [popular, setPopular] = useState<Song[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hero, setHero] = useState<Hero | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.library().then(setLibrary).catch((e) => {
      setLibrary([]);
      setError(String(e.message ?? e));
    });
    api.wishlist().then(setWishlist).catch(() => {});
    api.popular(24).then(setPopular).catch(() => {});
  }, []);
  useEffect(load, [load, nav.depth]);

  const heroFromLibrary = (i: LibraryItem): Hero => ({
    title: i.title, artist: i.artist, cover: i.cover_url,
    line: ['Ready to sing', i.key && `Key of ${i.key}`, i.duration_s && formatDuration(i.duration_s), i.has_lyrics ? 'Synced lyrics' : 'No lyrics yet']
      .filter(Boolean).join('  ·  '),
  });
  const heroFromSong = (song: Song): Hero => ({
    title: song.title, artist: song.artist, cover: song.cover_url,
    line: [song.bundle_id ? 'Ready to sing' : 'Not in your library yet', song.year, song.length_ms && formatDuration(song.length_ms / 1000)]
      .filter(Boolean).join('  ·  '),
  });

  useEffect(() => {
    if (!hero && library?.length) setHero(heroFromLibrary(library[0]));
    else if (!hero && library && popular.length) setHero(heroFromSong(popular[0]));
  }, [library, popular, hero]);

  return (
    <View style={{ flex: 1 }}>
      <Backdrop uri={hero?.cover} />
      {/* Header + hero stay pinned; only the shelves scroll (Apple TV / Fire TV convention). */}
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: s(96), paddingTop: s(56) }}>
          <Text style={{ fontSize: s(40), fontWeight: '900', color: colors.text, letterSpacing: -1 }}>
            Karaoke<Text style={{ color: colors.pink }}>App</Text>
          </Text>
          <Button icon="⌕" label="Search" compact onPress={() => nav.push({ name: 'search' })} />
        </View>

        <View style={{ paddingHorizontal: s(96), paddingTop: s(48), height: s(300) }}>
          {hero ? (
            <>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: s(80), fontWeight: '900', letterSpacing: -2 }}>{hero.title}</Text>
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: s(38), fontWeight: '600', marginTop: s(6) }}>{hero.artist}</Text>
              <Text style={{ color: colors.cyan, fontSize: s(24), fontWeight: '700', marginTop: s(20), letterSpacing: 0.5 }}>{hero.line}</Text>
            </>
          ) : (
            <Text style={{ color: colors.muted, fontSize: s(40) }}>{library === null ? 'Loading…' : ''}</Text>
          )}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: s(80) }}>

        {error ? (
          <View style={{ marginHorizontal: s(96), marginBottom: s(40), padding: s(28), borderRadius: s(18), backgroundColor: colors.surface }}>
            <Text style={{ color: colors.gold, fontSize: s(28), fontWeight: '800' }}>Can't reach the KaraokeApp server</Text>
            <Text style={{ color: colors.muted, fontSize: s(22), marginTop: s(8) }}>
              Start it on your Mac with `uv run karaoke-api` in services/api, then try again. ({error})
            </Text>
            <View style={{ flexDirection: 'row', marginTop: s(20) }}>
              <Button label="Try again" compact autoFocus onPress={load} />
            </View>
          </View>
        ) : null}

        <Shelf title="Ready to sing" hint={library?.length ? `${library.length} songs` : undefined}>
          {library?.length ? (
            library.map((i, idx) => (
              <SongCard
                key={i.bundle_id}
                data={libraryCard(i)}
                autoFocus={idx === 0}
                onFocus={() => setHero(heroFromLibrary(i))}
                onPress={() => nav.push({ name: 'song', bundleId: i.bundle_id })}
              />
            ))
          ) : (
            <View style={{ width: s(760), padding: s(28), borderRadius: s(18), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontSize: s(26), fontWeight: '700' }}>Your library is empty</Text>
              <Text style={{ color: colors.muted, fontSize: s(22), marginTop: s(8) }}>
                Process songs you own with services/pipeline and they'll show up here, ready to sing.
              </Text>
            </View>
          )}
        </Shelf>

        {wishlist.length ? (
          <Shelf title="Your wishlist" hint="songs to add to your library">
            {wishlist.map((song) => (
              <SongCard key={song.id} data={songCard(song)} onFocus={() => setHero(heroFromSong(song))} onPress={() => nav.push({ name: 'song', song })} />
            ))}
          </Shelf>
        ) : null}

        {popular.length ? (
          <Shelf title="Classics" hint="from the full catalog">
            {popular.map((song) => (
              <SongCard
                key={song.id}
                data={songCard(song)}
                autoFocus={!library?.length && song === popular[0]}
                onFocus={() => setHero(heroFromSong(song))}
                onPress={() => nav.push(song.bundle_id ? { name: 'song', bundleId: song.bundle_id } : { name: 'song', song })}
              />
            ))}
          </Shelf>
        ) : null}
      </ScrollView>
    </View>
  );
}
