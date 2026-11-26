/** Tiny CSV and XLSX readers for listening-history exports (no dependencies beyond fflate). */
import { strFromU8, unzipSync } from 'fflate';

/** RFC 4180 CSV → rows of cells (quoted fields, doubled quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** Rows as objects keyed by the header row (headers trimmed). */
export function csvRecords(rows: string[][]): Record<string, string>[] {
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const unescapeXml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (_, e: string) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : e === 'amp' ? '&'
    : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('');
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Sheet names in an .xlsx workbook. */
export function xlsxSheets(bytes: Uint8Array): { names: string[]; read: (name: string) => (string | number)[][] } {
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  const get = (p: string) => (files[p] ? strFromU8(files[p]!) : '');
  const workbook = get('xl/workbook.xml');
  const rels = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1] ?? '', target = /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? '';
    return [id, target.replace(/^\/?(xl\/)?/, 'xl/')];
  }));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: unescapeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? ''),
    path: rels.get(/\br:id="([^"]+)"/.exec(m[0])?.[1] ?? '') ?? '',
  }));
  let shared: string[] | null = null;
  const sharedStrings = () => (shared ??= [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!)));
  return {
    names: sheets.map((s) => s.name),
    read(name) {
      const xml = get(sheets.find((s) => s.name === name)?.path ?? '');
      const out: (string | number)[][] = [];
      for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const row: (string | number)[] = [];
        for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1]!, body = c[2] ?? '';
          const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
          const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          const value: string | number = type === 's' ? sharedStrings()[Number(v)] ?? ''
            : type === 'inlineStr' ? textOf(body)
            : type === 'str' || type === 'b' || type === 'e' ? unescapeXml(v ?? '')
            : v != null && v !== '' ? Number(v) : '';
          row[ref ? colIndex(ref) : row.length] = value;
        }
        out.push(Array.from(row, (x) => x ?? ''));
      }
      return out;
    },
  };
}
