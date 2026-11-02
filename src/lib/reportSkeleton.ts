/**
 * A report reduced to its structure, with everything that could identify
 * whose report it was taken out (2026-11-02, the owner's own model).
 *
 * The owner asked for an AI of Forma's own, learned from the reports their
 * company has built, and chose that whatever ships with the free, public app
 * be learned from STRUCTURE only. Those reports are client material: client
 * names, their queries and their logos. So a report goes into the model only
 * as a skeleton:
 * - its paper, margins and bands;
 * - every control's kind, place, size, font, alignment and borders;
 * - the ROLE each text plays: a title, a caption, a bound value, a total or
 *   page information.
 * Never the text itself (a caption keeps only its length), a field or
 * control name, a query, a parameter or a picture.
 *
 * The same reduction is what lets the app learn from a report a user keeps
 * (the memory feature): what it remembers of their reports is their shape.
 * Pure, so it runs under Node for the training script and the tests.
 */
import type { BandKind, PreviewBand, PreviewControl, ReportStructure } from './reportPreview';

export type SkeletonKind =
  | 'label'
  | 'table'
  | 'line'
  | 'pageInfo'
  | 'picture'
  | 'panel'
  | 'richText'
  | 'shape'
  | 'barcode'
  | 'subreport'
  | 'chart'
  | 'checkbox'
  | 'other';

/** What a piece of text is for. */
export type SkeletonRole = 'title' | 'caption' | 'value' | 'total' | 'pageInfo' | 'decoration';

export interface SkeletonFont {
  family: string;
  /** Points. */
  size: number;
  bold: boolean;
  italic: boolean;
}

/** One table cell: what it shows, how wide it is among its row, never what it says. */
export interface SkeletonCell {
  weight: number;
  role: SkeletonRole;
  align: 'left' | 'center' | 'right';
  /** The length of a literal caption, so a layout can size it; 0 for a bound value. */
  chars: number;
  font: SkeletonFont | null;
}

export interface SkeletonControl {
  kind: SkeletonKind;
  role: SkeletonRole;
  /** Band-relative, in the report's unit, panels flattened. */
  x: number;
  y: number;
  w: number;
  h: number;
  font: SkeletonFont | null;
  align: 'left' | 'center' | 'right';
  /** Top 1, right 2, bottom 4, left 8. */
  borders: number;
  chars: number;
  /** For a table: each row's cells. */
  rows?: SkeletonCell[][];
}

export interface SkeletonBand {
  kind: BandKind;
  height: number;
  /** How many fields a group header groups by. */
  groupFields: number;
  controls: SkeletonControl[];
}

export interface ReportSkeleton {
  paper: string;
  landscape: boolean;
  width: number;
  height: number;
  margins: { top: number; bottom: number; left: number; right: number };
  bands: SkeletonBand[];
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The paper a page size is, in hundredths of an inch, by its nearer orientation. */
export function paperName(width: number, height: number): { paper: string; landscape: boolean } {
  const landscape = width > height;
  const [w, h] = landscape ? [height, width] : [width, height];
  const papers: [string, number, number][] = [
    ['A4', 827, 1169],
    ['Letter', 850, 1100],
    ['Legal', 850, 1400],
    ['A5', 583, 827],
    ['A3', 1169, 1654],
    ['Executive', 725, 1050],
  ];
  const hit = papers.find(([, pw, ph]) => Math.abs(w - pw) <= 6 && Math.abs(h - ph) <= 6);
  return { paper: hit ? hit[0] : 'Custom', landscape };
}

const KINDS: Record<string, SkeletonKind> = {
  XRLabel: 'label',
  XRTable: 'table',
  XRLine: 'line',
  XRPageInfo: 'pageInfo',
  XRPictureBox: 'picture',
  XRPanel: 'panel',
  XRRichText: 'richText',
  XRShape: 'shape',
  XRBarCode: 'barcode',
  XRSubreport: 'subreport',
  XRChart: 'chart',
  XRCheckBox: 'checkbox',
};

const fontOf = (family: string | null, size: number | null, bold: boolean, italic: boolean): SkeletonFont | null =>
  size ? { family: family ?? 'Arial', size: round(size), bold, italic } : null;

const bordersOf = (b: { top: boolean; right: boolean; bottom: boolean; left: boolean }) =>
  (b.top ? 1 : 0) | (b.right ? 2 : 0) | (b.bottom ? 4 : 0) | (b.left ? 8 : 0);

/** The role of a text from what it is bound to, never from what it says. */
function textRole(field: string | null, running: string | null, text: string): SkeletonRole {
  if (field) return running ? 'total' : 'value';
  return text.trim() ? 'caption' : 'decoration';
}

function skeletonControl(c: PreviewControl): SkeletonControl {
  const kind = KINDS[c.type] ?? 'other';
  const font = fontOf(c.fontFamily, c.fontSize, c.bold, c.italic);
  const base = {
    kind,
    x: round(c.x + c.offsetX),
    y: round(c.y + c.offsetY),
    w: round(c.width),
    h: round(c.height),
    font,
    align: c.align,
    borders: bordersOf(c.borders),
  };
  if (kind === 'table') {
    return {
      ...base,
      role: 'value',
      chars: 0,
      rows: c.rows.map((r) =>
        r.cells.map((cell) => {
          const role = textRole(cell.field, cell.data.running, cell.text);
          return {
            weight: round(cell.weight),
            role,
            align: cell.align,
            chars: role === 'caption' ? Math.min(200, cell.text.trim().length) : 0,
            font: fontOf(cell.fontFamily, cell.fontSize, cell.bold, cell.italic),
          };
        }),
      ),
    };
  }
  if (kind === 'pageInfo') return { ...base, role: 'pageInfo', chars: 0 };
  if (kind === 'label' || kind === 'richText' || kind === 'checkbox') {
    const role = textRole(c.field, c.data.running, kind === 'richText' ? '' : c.text);
    return { ...base, role, chars: role === 'caption' ? Math.min(200, c.text.trim().length) : 0 };
  }
  return { ...base, role: 'decoration', chars: 0 };
}

/**
 * The largest literal text in a report or page header, when it is larger than
 * the report's usual text, is its title: the role a request's own title fills.
 */
function markTitle(bands: SkeletonBand[]): void {
  const sizes = bands.flatMap((b) => b.controls.flatMap((c) => (c.font ? [c.font.size] : [])));
  if (!sizes.length) return;
  const typical = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
  let best: SkeletonControl | null = null;
  for (const b of bands) {
    if (b.kind !== 'ReportHeader' && b.kind !== 'PageHeader') continue;
    for (const c of b.controls) {
      if (c.role !== 'caption' || !c.font) continue;
      if (!best || c.font.size > best.font!.size) best = c;
    }
  }
  if (best && best.font!.size >= typical + 1.5) best.role = 'title';
}

/** A parsed report as its skeleton: margins and bands, controls by kind, place and role. */
export function skeletonOf(s: ReportStructure): ReportSkeleton {
  const { paper, landscape } = paperName(s.page.width, s.page.height);
  const bands: SkeletonBand[] = s.bands.map((b: PreviewBand) => ({
    kind: b.kind,
    height: round(b.height),
    groupFields: b.kind === 'GroupHeader' ? b.fields.length : 0,
    controls: b.controls.filter((c) => c.visible).map(skeletonControl),
  }));
  markTitle(bands);
  return {
    paper,
    landscape,
    width: round(s.page.width),
    height: round(s.page.height),
    margins: { top: round(s.margins.top), bottom: round(s.margins.bottom), left: round(s.margins.left), right: round(s.margins.right) },
    bands,
  };
}

/** Every text-bearing place in a skeleton: its labels and its table cells, with the band each sits in. */
export function skeletonTexts(k: ReportSkeleton): { band: BandKind; role: SkeletonRole; font: SkeletonFont | null; h: number }[] {
  const out: { band: BandKind; role: SkeletonRole; font: SkeletonFont | null; h: number }[] = [];
  for (const b of k.bands) {
    for (const c of b.controls) {
      if (c.rows) {
        for (const row of c.rows) for (const cell of row) out.push({ band: b.kind, role: cell.role, font: cell.font ?? c.font, h: c.h / Math.max(1, c.rows.length) });
      } else if (c.kind === 'label' || c.kind === 'pageInfo' || c.kind === 'richText') {
        out.push({ band: b.kind, role: c.role, font: c.font, h: c.h });
      }
    }
  }
  return out;
}

/** The names of the numbers `skeletonFeatures` returns, in order. */
export const FEATURE_NAMES = [
  'landscape',
  'smallPage',
  'headerShare',
  'detailHeight',
  'detailTexts',
  'detailValues',
  'detailHasTable',
  'groupHeaders',
  'totals',
  'headerCaptions',
  'lines',
  'pictures',
  'pageFooter',
  'reportFooter',
  'subReports',
] as const;

/**
 * The numbers two reports are compared by: what kind of page, how much of it
 * is heading, how a record prints, how it groups and totals. Counts are on a
 * log scale, so a report with 400 labels is not 40 times further away than one
 * with ten.
 */
export function skeletonFeatures(k: ReportSkeleton): number[] {
  const log = (n: number) => Math.log1p(n);
  const printable = Math.max(1, k.height - k.margins.top - k.margins.bottom);
  const of = (kind: BandKind) => k.bands.filter((b) => b.kind === kind);
  const texts = skeletonTexts(k);
  const detail = of('Detail');
  const detailTexts = texts.filter((t) => t.band === 'Detail');
  const headerHeight = [...of('ReportHeader'), ...of('PageHeader')].reduce((s, b) => s + b.height, 0);
  const controls = k.bands.flatMap((b) => b.controls);
  return [
    k.landscape ? 1 : 0,
    k.width * k.height < 600 * 900 ? 1 : 0,
    Math.min(1, headerHeight / printable),
    log(detail.reduce((s, b) => s + b.height, 0)),
    log(detailTexts.length),
    log(detailTexts.filter((t) => t.role === 'value').length),
    detail.some((b) => b.controls.some((c) => c.kind === 'table')) ? 1 : 0,
    log(of('GroupHeader').length),
    log(texts.filter((t) => t.role === 'total').length),
    log(texts.filter((t) => (t.band === 'ReportHeader' || t.band === 'PageHeader') && t.role === 'caption').length),
    log(controls.filter((c) => c.kind === 'line').length),
    log(controls.filter((c) => c.kind === 'picture').length),
    of('PageFooter').length ? 1 : 0,
    of('ReportFooter').length ? 1 : 0,
    log(of('DetailReport').length + controls.filter((c) => c.kind === 'subreport').length),
  ];
}
