/**
 * A report skeleton written as compact text, and read back (2026-11-03,
 * milestone 6 of docs/proposals/own-model.md).
 *
 * Milestone 6 fine-tunes a small open vision model to look at a picture of a
 * report page and write its skeleton. As JSON, the owner's 359 skeletons
 * average about 11 kB and the largest is 46 kB, far too much for a small model
 * to write. So the model writes this format instead:
 * - one line per band and one per control;
 * - fixed positions, so every field is always in the same place;
 * - whole hundredths of an inch, the unit a skeleton is already in.
 *
 *   page A4 portrait 827 1169 50 50 60 60
 *   band PageHeader 120 0
 *   label title 0 10 500 40 Arial:14b c 0 18
 *   table value 0 80 707 25 Arial:9 l 15 0
 *   row caption 1 Arial:9b l 4 | caption 2.5 Arial:9b l 11 | value 1 - r 0
 *
 * `page`: the paper, the orientation, then width, height and the top, bottom,
 * left and right margins.
 * `band`: the band's kind, its height and how many fields a group header
 * groups by.
 * A control: its kind, role, x, y, w and h, then font, alignment, borders and
 * the length of a caption.
 * A font token is `Family:size`, with spaces in the family written as `_`, and
 * `b` or `i` after the size for bold or italic; `-` means no font.
 * A `row` line follows its table, with its cells separated by `|`. Each cell is
 * its role, width weight, font, alignment and caption length.
 *
 * The same module reads the model's answer back, so reading is tolerant: a
 * line it cannot understand is skipped and named in `problems`, never thrown.
 * The only answer it refuses outright is one with no `page` line.
 *
 * `PUBLIC_FONTS` and `strayWords` serve the dataset packer
 * (scripts/model/dataset.ts). A font family is the one string in a skeleton
 * that could be a client's own, so every family outside the public list
 * becomes Arial before anything leaves the machine. `strayWords` then confirms
 * that no other word made it into the text.
 */
import type { BandKind } from './reportPreview';
import type { ReportSkeleton, SkeletonBand, SkeletonCell, SkeletonControl, SkeletonFont, SkeletonKind, SkeletonRole } from './reportSkeleton';

const KINDS: readonly SkeletonKind[] = ['label', 'table', 'line', 'pageInfo', 'picture', 'panel', 'richText', 'shape', 'barcode', 'subreport', 'chart', 'checkbox', 'other'];
const ROLES: readonly SkeletonRole[] = ['title', 'caption', 'value', 'total', 'pageInfo', 'decoration'];
const BANDS: readonly BandKind[] = ['TopMargin', 'ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'DetailReport', 'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin', 'Unknown'];
const PAPERS = ['A4', 'Letter', 'Legal', 'A5', 'A3', 'Executive', 'Custom'];
const ALIGN = { left: 'l', center: 'c', right: 'r' } as const;
const ALIGN_BACK: Record<string, 'left' | 'center' | 'right'> = { l: 'left', c: 'center', r: 'right' };

/**
 * Typefaces that ship with Windows or are sold under their own name: a family
 * a client's report can use without the name saying anything about the
 * client. DIN Pro is commercial, not a system font. It is here because 103 of
 * the owner's reports use it under one of its spellings, and the shipped model
 * already names it.
 */
export const PUBLIC_FONTS: readonly string[] = [
  'Arial', 'Arial Black', 'Arial Narrow', 'Arial Unicode MS', 'Bahnschrift', 'Book Antiqua', 'Bookman Old Style',
  'Calibri', 'Cambria', 'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier',
  'Courier New', 'DIN Pro', 'DIN Pro Bold', 'DINPro', 'DINPro-Bold',
  'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Gill Sans MT', 'Helvetica', 'Impact',
  'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'MS Sans Serif', 'MS Serif', 'Palatino Linotype',
  'Rockwell', 'Segoe UI', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];

const num = (v: number) => String(Math.round(v * 100) / 100);
const whole = (v: number) => String(Math.round(v));

/** `Arial:9.75b`, or `-` for no font. */
export function fontToken(f: SkeletonFont | null): string {
  if (!f) return '-';
  return `${f.family.trim().replace(/\s+/g, '_')}:${num(f.size)}${f.bold ? 'b' : ''}${f.italic ? 'i' : ''}`;
}

/** The font a token names; null for `-`, undefined for a token that is not a font. */
function readFont(t: string): SkeletonFont | null | undefined {
  if (t === '-') return null;
  const m = /^([^:\s]+):(\d+(?:\.\d+)?)(b?)(i?)$/.exec(t);
  if (!m) return undefined;
  return { family: m[1].replace(/_/g, ' '), size: Number(m[2]), bold: m[3] === 'b', italic: m[4] === 'i' };
}

const cellText = (c: SkeletonCell) => `${c.role} ${num(c.weight)} ${fontToken(c.font)} ${ALIGN[c.align]} ${c.chars}`;

/** A skeleton as the text the vision model learns to write. */
export function skeletonToText(k: ReportSkeleton): string {
  const m = k.margins;
  const lines = [`page ${k.paper} ${k.landscape ? 'landscape' : 'portrait'} ${whole(k.width)} ${whole(k.height)} ${whole(m.top)} ${whole(m.bottom)} ${whole(m.left)} ${whole(m.right)}`];
  for (const b of k.bands) {
    lines.push(`band ${b.kind} ${whole(b.height)} ${b.groupFields}`);
    for (const c of b.controls) {
      lines.push(`${c.kind} ${c.role} ${whole(c.x)} ${whole(c.y)} ${whole(c.w)} ${whole(c.h)} ${fontToken(c.font)} ${ALIGN[c.align]} ${c.borders} ${c.chars}`);
      for (const row of c.rows ?? []) lines.push(`row ${row.map(cellText).join(' | ')}`.trimEnd());
    }
  }
  return lines.join('\n');
}

export interface SkeletonReading {
  /** Null only when the text has no `page` line. */
  skeleton: ReportSkeleton | null;
  /** One entry per line that was skipped, by line number. */
  problems: string[];
}

const isNum = (t: string | undefined) => t !== undefined && t !== '' && Number.isFinite(Number(t));

/** The text a vision model wrote, read back as a skeleton. Tolerant: see the module comment. */
export function textToSkeleton(text: string): SkeletonReading {
  const problems: string[] = [];
  let page: Omit<ReportSkeleton, 'bands'> | null = null;
  const bands: SkeletonBand[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const at = `line ${i + 1}`;
    if (!line || line.startsWith('```')) continue;
    const t = line.split(/\s+/);
    const head = t[0];
    if (head === 'page') {
      if (t.length !== 9 || !PAPERS.includes(t[1]) || (t[2] !== 'portrait' && t[2] !== 'landscape') || !t.slice(3).every(isNum)) {
        problems.push(`${at}: a page line needs a paper, an orientation and six numbers`);
        continue;
      }
      const [w, h, top, bottom, left, right] = t.slice(3).map(Number);
      page = { paper: t[1], landscape: t[2] === 'landscape', width: w, height: h, margins: { top, bottom, left, right } };
    } else if (head === 'band') {
      if (!BANDS.includes(t[1] as BandKind) || !isNum(t[2]) || (t.length > 3 && !isNum(t[3]))) {
        problems.push(`${at}: a band line needs a band kind and a height`);
        continue;
      }
      bands.push({ kind: t[1] as BandKind, height: Number(t[2]), groupFields: t.length > 3 ? Number(t[3]) : 0, controls: [] });
    } else if (head === 'row') {
      const table = bands.at(-1)?.controls.at(-1);
      if (!table || table.kind !== 'table') {
        problems.push(`${at}: a row line must follow a table`);
        continue;
      }
      const row = readRow(line.slice(3).trim());
      if (!row) problems.push(`${at}: a cell needs a role, a weight, a font, an alignment and a length`);
      else table.rows!.push(row);
    } else if (KINDS.includes(head as SkeletonKind)) {
      const band = bands.at(-1);
      const control = readControl(t);
      if (!band) problems.push(`${at}: a control before any band`);
      else if (!control) problems.push(`${at}: a control needs a kind, a role, four numbers, a font, an alignment, borders and a length`);
      else band.controls.push(control);
    } else {
      problems.push(`${at}: not understood`);
    }
  }
  if (!page) return { skeleton: null, problems: [...problems, 'no page line'] };
  return { skeleton: { ...page, bands }, problems };
}

function readControl(t: string[]): SkeletonControl | null {
  const font = readFont(t[6] ?? '');
  if (t.length !== 10 || !ROLES.includes(t[1] as SkeletonRole) || !t.slice(2, 6).every(isNum) || font === undefined || !ALIGN_BACK[t[7]] || !isNum(t[8]) || !isNum(t[9])) return null;
  const [x, y, w, h] = t.slice(2, 6).map(Number);
  const control: SkeletonControl = { kind: t[0] as SkeletonKind, role: t[1] as SkeletonRole, x, y, w, h, font, align: ALIGN_BACK[t[7]], borders: Number(t[8]), chars: Number(t[9]) };
  if (control.kind === 'table') control.rows = [];
  return control;
}

/** A row line's cells; null when any cell cannot be read, so the row is skipped whole. */
function readRow(body: string): SkeletonCell[] | null {
  const cells: SkeletonCell[] = [];
  for (const part of body ? body.split('|') : []) {
    const c = part.trim().split(/\s+/);
    const font = readFont(c[2] ?? '');
    if (c.length !== 5 || !ROLES.includes(c[0] as SkeletonRole) || !isNum(c[1]) || font === undefined || !ALIGN_BACK[c[3]] || !isNum(c[4])) return null;
    cells.push({ role: c[0] as SkeletonRole, weight: Number(c[1]), font, align: ALIGN_BACK[c[3]], chars: Number(c[4]) });
  }
  return cells;
}

/**
 * The skeleton with each band as tall as it prints. DevExpress prints a band
 * tall enough to hold its controls, whatever height it was drawn at (see
 * `control-below-band` in repxLayout.ts). One of the owner's Detail bands is
 * drawn 3.7 hundredths high under a row of labels 17.5 high, and it prints
 * 17.5 high. A picture shows the printed height, so that is the height the
 * model is taught.
 */
export function withPrintedHeights(k: ReportSkeleton): ReportSkeleton {
  return { ...k, bands: k.bands.map((b) => ({ ...b, height: Math.max(b.height, ...b.controls.map((c) => c.y + c.h)) })) };
}

/** The skeleton with every font outside `PUBLIC_FONTS` replaced by Arial, and how many were. */
export function publicFontsOnly(k: ReportSkeleton): { skeleton: ReportSkeleton; replaced: number } {
  const allowed = new Set(PUBLIC_FONTS.map((f) => f.toLowerCase()));
  let replaced = 0;
  const fix = (f: SkeletonFont | null): SkeletonFont | null => {
    if (!f || allowed.has(f.family.trim().toLowerCase())) return f;
    replaced++;
    return { ...f, family: 'Arial' };
  };
  const bands = k.bands.map((b) => ({
    ...b,
    controls: b.controls.map((c) => ({
      ...c,
      font: fix(c.font),
      ...(c.rows ? { rows: c.rows.map((r) => r.map((cell) => ({ ...cell, font: fix(cell.font) }))) } : {}),
    })),
  }));
  return { skeleton: { ...k, bands }, replaced };
}

/**
 * Every word in a skeleton's text that is not a number, a word of the format,
 * a font token for a public font, or a kind, role, band or paper. Empty for
 * text `skeletonToText` wrote from a skeleton that went through
 * `publicFontsOnly`; the dataset packer refuses to write anything otherwise.
 */
export function strayWords(text: string): string[] {
  const allowed = new Set<string>(['page', 'band', 'row', 'portrait', 'landscape', '|', '-', 'l', 'c', 'r', ...KINDS, ...ROLES, ...BANDS, ...PAPERS]);
  const fonts = new Set(PUBLIC_FONTS.map((f) => f.replace(/\s+/g, '_')));
  const found = new Set<string>();
  for (const word of text.split(/\s+/)) {
    if (!word || allowed.has(word) || isNum(word)) continue;
    const font = /^([^:]+):\d+(?:\.\d+)?b?i?$/.exec(word);
    if (font && fonts.has(font[1])) continue;
    found.add(word);
  }
  return [...found];
}
