/**
 * Picking YouTube videos to sing along to: the song's original recording (ideally YouTube Music's "Topic" upload,
 * which is the studio track and so matches synced lyrics exactly) and karaoke/instrumental versions for singing
 * without the lead vocal. Pure functions, tested in youtube_rank_test.ts.
 */
export interface YtVideo { id: string; title: string; channel: string; durationS: number | null }
export interface RankedVideo extends YtVideo {
  kind: 'original' | 'karaoke'; offsetGuessMs: number; quality: number;
  /** an official instrumental of the same recording: plays in exact step with the original (ideal for the guide) */
  sameMaster?: boolean;
}

const KARAOKE = /\b(karaoke|instrumental|backing track|sing ?along|no vocals?|without vocals?|minus one|off ?vocal)\b/i;
const NOT_ORIGINAL = /\b(cover|live|remix|sped ?up|slowed|reverb|nightcore|reaction|8d|piano version|acoustic version|tutorial|lesson|8 ?bit)\b/i;
const NOT_KARAOKE = /\b(cover|live|remix|sped ?up|slowed|nightcore|reaction|tutorial|lesson|8d)\b/i;
/** Re-arrangements, not the song as recorded: acoustic/piano/guitar takes, lo-fi, orchestral, etc. */
const REARRANGED = /\b(acoustic|piano|guitar|unplugged|ukulele|lo-?fi|orchestral|strings|jazz|rock|reggae|bossa|lullaby|music box|8 ?bit|cello|violin|sax(ophone)?|harp|stripped|ballad|female|male|lower|higher|duet) (version|ver\.?|cover|karaoke|instrumental|backing)|\b(piano|guitar|acoustic) (karaoke|instrumental|backing)|backing tracks?\b.*\b(guitar|piano)\b/i;
/** Karaoke producers who re-record songs faithfully to the original arrangement. */
const KARAOKE_BRANDS = /sing king|karafun|karaoke version|stingray|zoom karaoke|party tyme|sunfly|singsnap|lucky voice|kj ?karaoke|zzang|musisi|edkara|global karaoke|singsong|karaoke hits|bellysings|peareoke|hdpopkaraoke|karaoke channel/i;
const KARAOKE_CHANNELS = /sing king|karafun|karaoke version|stingray|zzang|musisi|singsong|sing2music|carpool|karaoke hits|global karaoke|edkara|songjam|kj/i;

/** ISO-8601 duration from the YouTube API ("PT3M25S") to seconds. */
export function isoSeconds(iso: string | undefined | null): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
/** Share of the song title's words that appear in the video title. */
function titleMatch(videoTitle: string, songTitle: string): number {
  const v = new Set(words(videoTitle));
  const s = words(songTitle.replace(/\(.*?\)|\[.*?\]/g, ''));
  return s.length ? s.filter((w) => v.has(w)).length / s.length : 0;
}

/**
 * Where the lyrics start in this video, as a first guess before anyone corrects it. A video that's longer than the
 * studio track usually has an intro (title card, music-video skit), so the extra length is taken as lead-in, capped.
 */
export function offsetGuessMs(kind: 'original' | 'karaoke', durationS: number | null, songS: number | null, topic: boolean): number {
  if (topic || durationS == null || songS == null) return 0;
  const extra = durationS - songS;
  if (extra <= 1.5) return 0;
  return Math.round(Math.min(extra, kind === 'karaoke' ? 20 : 30) * 1000);
}

export function rankVideos(videos: YtVideo[], song: { title: string; artist: string; durationS: number | null }): { originals: RankedVideo[]; karaoke: RankedVideo[] } {
  const originals: RankedVideo[] = [], karaoke: RankedVideo[] = [];
  const seen = new Set<string>();
  for (const v of videos) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    const match = titleMatch(v.title, song.title);
    if (match < 0.6) continue;
    const topic = / - Topic$/i.test(v.channel);
    const durDiff = v.durationS != null && song.durationS != null ? v.durationS - song.durationS : null;
    if (v.durationS != null && (v.durationS < 60 || v.durationS > 15 * 60)) continue;
    if (KARAOKE.test(v.title)) {
      if (NOT_KARAOKE.test(v.title)) continue;
      // a real karaoke version: the song's own arrangement (no acoustic/piano re-takes) and the whole song (a
      // version that stops early cuts off the singer, e.g. an outro); a little longer (title card) is fine
      if (REARRANGED.test(`${v.title} ${v.channel}`) && !REARRANGED.test(song.title)) continue;
      if (durDiff != null && (durDiff < -8 || durDiff > 45)) continue;
      // Best: the artist's own instrumental (same master as the original, so the guide vocal stays in step, and no
      // lyrics on screen competing with ours). Then karaoke producers' faithful re-recordings; plain uploads last.
      const rerecorded = /re-?record|cover|tribute|in the style of|made famous|as made/i.test(v.title);
      const artistChannel = titleMatch(v.channel.replace(/ - Topic$/i, ''), song.artist) >= 0.5;
      const official = /instrumental/i.test(v.title) && !/karaoke/i.test(v.title) && !rerecorded
        && (artistChannel || /official instrumental/i.test(v.title));
      // same master: an official instrumental whose length matches the original to the second
      const sameMaster = official && durDiff != null && Math.abs(durDiff) <= 2;
      const brand = KARAOKE_BRANDS.test(v.channel);
      let q = match + (official ? 1.2 : 0) + (sameMaster ? 0.5 : 0) + (brand ? 0.6 : 0)
        + (/karaoke/i.test(v.title) ? 0.2 : 0)
        - (!official && !brand && !/karaoke/i.test(v.title) ? 0.5 : 0)          // a stray "instrumental" upload
        - (/guide (melody|vocal)|with melody|melody guide/i.test(v.title) && !/no guide/i.test(v.title) ? 0.4 : 0)
        - (durDiff == null ? 0.2 : durDiff < -2 ? 0.6 : Math.abs(durDiff) / 60);  // shorter than the song: risky
      if (/female key|male key|lower key|higher key|key of|[+-]\d ?(key|semitone)/i.test(v.title)) q -= 0.5;
      // a karaoke video of someone else's version (same title, different artist)
      if (titleMatch(`${v.title} ${v.channel}`, song.artist) < 0.5) q -= 0.6;
      karaoke.push({ ...v, kind: 'karaoke', quality: +q.toFixed(3), sameMaster,
                     offsetGuessMs: sameMaster ? 0 : offsetGuessMs('karaoke', v.durationS, song.durationS, false) });
    } else {
      if (NOT_ORIGINAL.test(v.title) && !NOT_ORIGINAL.test(song.title)) continue;
      const artistHit = titleMatch(`${v.title} ${v.channel}`, song.artist) >= 0.5;
      if (!artistHit) continue;
      let q = match + (topic ? 1 : 0) + (/official audio|\baudio\b/i.test(v.title) ? 0.5 : 0) + (/lyric/i.test(v.title) ? 0.2 : 0)
        + (/vevo$/i.test(v.channel) ? 0.2 : 0) - (durDiff == null ? 0.3 : Math.min(1, Math.abs(durDiff) / 20));
      originals.push({ ...v, kind: 'original', quality: +q.toFixed(3), offsetGuessMs: offsetGuessMs('original', v.durationS, song.durationS, topic) });
    }
  }
  originals.sort((a, b) => b.quality - a.quality);
  karaoke.sort((a, b) => b.quality - a.quality);
  return { originals: originals.slice(0, 4), karaoke: karaoke.slice(0, 4) };
}
