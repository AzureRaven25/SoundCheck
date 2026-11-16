/**
 * LRC parsing for SoundCheck lyrics.
 *
 * Supports plain LRC ("[01:23.45]text"), several timestamps per line, metadata tags
 * ("[ar:...]", ignored) and Enhanced LRC word timing ("[00:12.00]<00:12.00>Hello <00:12.50>world").
 * Output matches the `lyrics.content` JSON contract: {lines:[{start,end,text,words?}]}.
 */

export interface Word {
  start: number;
  end: number;
  text: string;
}
export interface Line {
  start: number;
  end: number;
  text: string;
  words?: Word[];
}
export interface ParsedLyrics {
  granularity: 'line' | 'word';
  lines: Line[];
}

const LINE_TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;

function seconds(min: string, sec: string): number {
  return Number(min) * 60 + Number(sec.replace(':', '.'));
}
const round = (x: number) => Math.round(x * 1000) / 1000;

export function parseLrc(lrc: string, songEnd?: number | null): ParsedLyrics {
  const entries: { start: number; body: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(LINE_TAG)];
    if (!tags.length) continue;
    const last = tags[tags.length - 1]!;
    const body = raw.slice(last.index! + last[0].length);
    for (const t of tags) entries.push({ start: seconds(t[1]!, t[2]!), body });
  }
  entries.sort((a, b) => a.start - b.start);

  let anyWords = false;
  const lines: Line[] = entries.map((e, i) => {
    const next = entries[i + 1];
    const end = next ? next.start : Math.max(songEnd ?? 0, e.start + 5);
    const wordTags = [...e.body.matchAll(WORD_TAG)];
    const text = e.body.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    const line: Line = { start: round(e.start), end: round(end), text };
    if (wordTags.length) {
      const words: Word[] = [];
      for (let w = 0; w < wordTags.length; w++) {
        const tag = wordTags[w]!;
        const from = tag.index! + tag[0].length;
        const to = w + 1 < wordTags.length ? wordTags[w + 1]!.index! : e.body.length;
        const wordText = e.body.slice(from, to).trim();
        if (!wordText) continue;
        const wStart = seconds(tag[1]!, tag[2]!);
        const wEnd = w + 1 < wordTags.length ? seconds(wordTags[w + 1]![1]!, wordTags[w + 1]![2]!) : end;
        words.push({ start: round(wStart), end: round(Math.max(wStart, wEnd)), text: wordText });
      }
      if (words.length) {
        line.words = words;
        anyWords = true;
      }
    }
    return line;
  });
  return { granularity: anyWords ? 'word' : 'line', lines };
}

/** Plain (unsynced) lyrics in the same contract: lines without timing. */
export function plainToContent(plain: string): { lines: { text: string }[] } {
  return { lines: plain.split(/\r?\n/).map((t) => ({ text: t.trim() })) };
}
