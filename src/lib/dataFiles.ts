/**
 * Data files attached in the chat (2026-11-05): a CSV, TSV, JSON, text, SQL,
 * Excel or Word file becomes a text attachment the AI is given beside the
 * words, and a table's columns are said to be the report's fields. Until
 * then the box took images, PDFs and `.repx` only, and anything else was
 * "not a supported type", so the data a report prints had to be pasted into
 * the message as a fenced block.
 *
 * Read in the browser, as everything attached is: nothing is uploaded to
 * read it. An `.xlsx` and a `.docx` are zip archives, read by `unzip` below
 * with the browser's own `DecompressionStream`, so no library is added for
 * them. What is kept is bounded: the first rows of a table, the start of a
 * document, enough for the AI to know the fields and how the values look
 * without spending the free tier on a whole export.
 */

/** The extensions taken as data. */
export const DATA_FILE_EXTENSIONS = ['.csv', '.tsv', '.json', '.txt', '.sql', '.xlsx', '.docx'] as const;

export function isDataFile(name: string): boolean {
  const lower = name.toLowerCase();
  return DATA_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Rows of a table kept for the AI; the rest are counted. */
export const MAX_ROWS = 25;
const MAX_COLUMNS = 60;
const MAX_TEXT = 12_000;
/** Refuses an archive entry that would inflate past this. */
const MAX_INFLATED = 20 * 1024 * 1024;

export interface DataFileText {
  /** What the AI is given. */
  text: string;
  /** A notice for the person, when something was left out or could not be read. */
  note?: string;
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

/** Split delimited text into rows, honouring quotes ("a, b" and "" inside). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** A cell as CSV writes it: quoted when it holds a comma, a quote or a line break. */
const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** A table as the AI is given it: its columns as fields, then its first rows. */
export function tableText(name: string, rows: string[][]): DataFileText {
  if (!rows.length) return { text: '', note: `"${name}" holds no rows.` };
  const [header, ...body] = rows;
  const columns = header.slice(0, MAX_COLUMNS).map((c, i) => c.trim() || `Column${i + 1}`);
  const kept = body.slice(0, MAX_ROWS).map((r) => columns.map((_, i) => (r[i] ?? '').trim()));
  const lines = [columns, ...kept].map((r) => r.map(csvCell).join(','));
  const more = body.length > MAX_ROWS ? `the first ${MAX_ROWS} of ${body.length} rows` : `all ${body.length} ${body.length === 1 ? 'row' : 'rows'}`;
  return {
    text:
      `DATA SOURCE (${name}), attached by the user: the data this report prints. ` +
      `Its columns are the report's fields: bind the detail rows' cells to them by these names, as [Name], ` +
      `and group, sort and total by them where the words ask.\n` +
      `Fields: ${columns.join(', ')}\n` +
      `Below, ${more}, as CSV:\n` +
      '```csv\n' + lines.join('\n') + '\n```',
    note: header.length > MAX_COLUMNS ? `"${name}" has ${header.length} columns; the first ${MAX_COLUMNS} were kept.` : undefined,
  };
}

/** A JSON file: an array of records is a table; anything else goes as written, cut short. */
export function jsonText(name: string, raw: string): DataFileText {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { text: '', note: `"${name}" is not valid JSON.` };
  }
  const records = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value).find(Array.isArray) : null;
  if (Array.isArray(records) && records.length && records.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const columns = [...new Set(records.flatMap((r) => Object.keys(r as object)))];
    const rows = records.map((r) => columns.map((c) => {
      const v = (r as Record<string, unknown>)[c];
      return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }));
    return tableText(name, [columns, ...rows]);
  }
  return plainText(name, JSON.stringify(value, null, 2), 'DATA SOURCE');
}

/** Text as written, cut short, under a heading saying what it is. */
export function plainText(name: string, raw: string, kind: 'DATA SOURCE' | 'DOCUMENT'): DataFileText {
  const text = raw.trim();
  if (!text) return { text: '', note: `"${name}" is empty.` };
  const cut = text.length > MAX_TEXT;
  const what =
    kind === 'DATA SOURCE'
      ? `DATA SOURCE (${name}), attached by the user: the data, or the schema, this report prints. Bind to the fields it names.`
      : `DOCUMENT (${name}), attached by the user: what they wrote about the report. Follow it as their words.`;
  return {
    text: `${what}\n${cut ? text.slice(0, MAX_TEXT) : text}${cut ? '\n(The rest was left out.)' : ''}`,
    note: cut ? `"${name}" is long; its first ${MAX_TEXT.toLocaleString()} characters were kept.` : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Zip archives (.xlsx, .docx)
 * ------------------------------------------------------------------ */

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length > MAX_INFLATED) throw new Error('an entry inflates past the limit');
  return out;
}

/**
 * The entries of a zip archive whose names `wanted` accepts, read through its
 * central directory: stored and deflated entries, which is what Office
 * writes. Throws on anything that is not a zip.
 */
export async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive');
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const out = new Map<string, Uint8Array>();
  const names = new TextDecoder();
  for (let n = 0; n < count && u32(bytes, at) === 0x02014b50; n++) {
    const method = u16(bytes, at + 10);
    const size = u32(bytes, at + 20);
    const nameLength = u16(bytes, at + 28);
    const skip = nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + skip;
    if (!wanted(name) || u32(bytes, local) !== 0x04034b50) continue;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
  }
  return out;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e.toLowerCase()],
  );

/** A column's letters as its index: A is 0, Z 25, AA 26. */
const columnIndex = (letters: string) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

/** The first worksheet of an Excel workbook, as rows of text. */
export async function xlsxRows(bytes: Uint8Array): Promise<string[][]> {
  const parts = await unzip(bytes, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const decode = new TextDecoder();
  const shared = [...decode.decode(parts.get('xl/sharedStrings.xml') ?? new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const sheetName = [...parts.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))[0];
  if (!sheetName) return [];
  const sheet = decode.decode(parts.get(sheetName));
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1];
      const type = /\bt="([^"]+)"/.exec(c[1])?.[1];
      const inner = c[2] ?? '';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      const value = type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? unescapeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? '') : unescapeXml(raw);
      cells[ref ? columnIndex(ref) : cells.length] = value;
    }
    rows.push(Array.from(cells, (v) => v ?? ''));
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** A Word document's text: paragraphs on lines, a table's cells joined by " | ". */
export async function docxText(bytes: Uint8Array): Promise<string> {
  const parts = await unzip(bytes, (n) => n === 'word/document.xml');
  const xml = new TextDecoder().decode(parts.get('word/document.xml') ?? new Uint8Array());
  return unescapeXml(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<\/w:tc>/g, ' | ')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ \| \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ *
 * One file
 * ------------------------------------------------------------------ */

/** What an attached data file gives the AI, by its kind. */
export async function readDataFile(name: string, bytes: Uint8Array): Promise<DataFileText> {
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith('.xlsx')) return tableText(name, await xlsxRows(bytes));
    if (lower.endsWith('.docx')) return plainText(name, await docxText(bytes), 'DOCUMENT');
    const raw = new TextDecoder().decode(bytes).replace(/^﻿/, '');
    if (lower.endsWith('.csv')) return tableText(name, parseDelimited(raw, ','));
    if (lower.endsWith('.tsv')) return tableText(name, parseDelimited(raw, '\t'));
    if (lower.endsWith('.json')) return jsonText(name, raw);
    if (lower.endsWith('.sql')) return plainText(name, raw, 'DATA SOURCE');
    return plainText(name, raw, 'DOCUMENT');
  } catch (err) {
    return { text: '', note: `"${name}" could not be read${err instanceof Error ? `: ${err.message}` : ''}.` };
  }
}
