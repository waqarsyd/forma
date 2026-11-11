/**
 * The chat's edits to an open report (2026-11-05).
 *
 * The owner asked for the chat to work as an agent: with a report open, a
 * message is answered by a model that has seen the report, and a change it can
 * make is made in place, rather than every message going to a full redesign.
 * Until then the chat turn saw the last ten messages and nothing else, so it
 * answered questions about the report without looking at it, and "make the
 * title bold" spent a classification request and then a generation that wrote
 * the whole REPX again: on the free tier's twenty requests a day, two of them,
 * and some 25,000 tokens, for one attribute.
 *
 * Three parts, all pure:
 *
 * - `reportOutline` is what the model is shown: every band and control by its
 *   `Name`, where it is in the file's own numbers, what it says or prints, its
 *   font and alignment, and the checks' findings. A few thousand tokens for a
 *   typical report, where the REPX itself is tens of thousands.
 * - `applyEdits` makes the edits the model asked for, through `repxEdit.ts`'s
 *   splices, so a byte nobody asked to change does not change. Controls are
 *   found by name, again for every edit, because a deletion renumbers what
 *   follows. An edit that cannot be made is declined with its reason, never
 *   guessed at.
 * - `describeChanges` says what actually changed, by comparing the report
 *   before and after, so the reply reports the file rather than the model's
 *   account of it. The full redesign's reply uses it too.
 *
 * The numbers in the outline and in an edit are the file's: `LocationFloat`
 * and `SizeF` as written, in the report's unit, a control's own `Dpi` taken
 * out (`reportGeometry.ts` is where conversions live; this converts nothing).
 * Font sizes are points, as `Font` writes them.
 */
import { marginsOf, parseReportStructure, type PreviewBand, type PreviewControl } from './reportPreview';
import {
  addGroupBand,
  addLabel,
  addLine,
  addPageInfo,
  bindText,
  deleteControl,
  duplicateControl,
  setBandHeight,
  moveControl,
  resizeControl,
  setCellText,
  setControlText,
  updateCell,
  updateControl,
  type ControlRef,
  type EditResult,
} from './repxEdit';
import { SUPPORTED_PAGE_SIZES, pageSizeInUnits } from './reportGeometry';
import { readRepxDataSources } from './repxSqlDataSource';
import { languageAsked, languageName, namesLanguage } from './repxTranslate';
import { NOT_FOLLOWED } from './chatTurn';
import { plainBand, plainKind } from './plainKind';

/**
 * What the model can ask for. Anything else is a redesign. The last seven
 * came on 2026-11-07 (agent audit item 22, the owner's four groups): each
 * was a full redesign, some 20,000 tokens, for what is one splice here.
 * A table's row or column is styled by `font`, `color`, `align`, `border`
 * and `format` naming the row or the cell alone.
 */
export const EDIT_OPS = [
  'text', 'move', 'resize', 'font', 'color', 'align', 'delete', 'add', 'paper', 'margins', 'visible',
  'duplicate', 'bandHeight', 'border', 'line', 'format', 'bind', 'pageNumber',
  // A sentence about what a control is for (2026-11-10, the third gap of
  // docs/proposals/ai-designers.md): written to AccessibleDescription, which
  // the accessibility checks want on a picture too, and shown in the outline.
  'describe',
  // The database's two (2026-11-09, the SQL Server programme, item 24): what
  // the report reads, written by Forma from the shared layout through the
  // `data` hook of `applyEdits`, and a group band on a field.
  'data', 'group',
] as const;
export type EditOp = (typeof EDIT_OPS)[number];

/** One edit, as the model writes it: the op and the fields that op reads. */
export interface AgentEdit {
  op: EditOp;
  /** A control's `Name`, exactly as the outline gives it. */
  control?: string;
  /** For a table's cell: 1-based, as the outline numbers them. */
  row?: number;
  cell?: number;
  /** A band, for `add`: its name, its kind (`Detail`, `PageFooter`) or its number in the outline. */
  band?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  family?: string;
  /** Points. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** `#RRGGBB`, or a colour's name. */
  foreColor?: string;
  backColor?: string;
  align?: 'left' | 'center' | 'right';
  paper?: string;
  landscape?: boolean;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  visible?: boolean;
  /** For `border`: which sides, "All", "None", or a list such as "Top, Bottom". */
  borders?: string;
  borderColor?: string;
  /** Pixels, as DevExpress writes `BorderWidth`; for `line`, its weight. */
  borderWidth?: number;
  /** For `format` and `pageNumber`: a .NET format such as "{0:N2}" or "Page {0} of {1}". */
  format?: string;
  /** For `bind`: the field a control or cell prints. */
  field?: string;
  /** For `pageNumber`: NumberOfTotal (the default), Number, Total or DateTime. */
  pageInfo?: string;
  /** For `add`, `line` and `pageNumber`: the new control's name, when it is free. */
  name?: string;
  /** For `data`: what the report reads, as `databaseAi.ts`'s `QueryJson`, checked against the shared layout. */
  query?: unknown;
  /** For `group`: a field to total in the group's footer. */
  total?: string;
}

/**
 * What only App can do for an edit (2026-11-09): `data` needs the shared
 * database's layout, which this module does not hold, so App passes the
 * function that writes the data source (`databaseAi.ts`'s `dataEditHook`).
 */
export interface EditHooks {
  data?: (xml: string, edit: AgentEdit) => EditResult;
  /**
   * The fields the report's data has, read off the report as it stands at
   * this edit, so a field a `data` edit just brought counts; null when the
   * data is not known (2026-11-10, batch AG item 24, `dataFieldsOf` in
   * lib/reportFacts.ts). A `bind` or `group` to any other field is declined.
   */
  fields?: (xml: string) => readonly string[] | null;
}

/** The field as the data spells it, or a decline naming what the data has; null when nothing is known. */
function inTheData(xml: string, field: string, hooks: EditHooks): { name: string } | { reason: string } | null {
  const known = hooks.fields?.(xml);
  if (!known) return null;
  const hit = known.find((k) => k === field) ?? known.find((k) => k.toLowerCase() === field.toLowerCase());
  if (hit) return { name: hit };
  const shown = known.slice(0, 12).map((k) => `[${k}]`).join(', ');
  return { reason: `the report's data has no field [${field}]; it has ${shown}${known.length > 12 ? ` and ${known.length - 12} more` : ''}` };
}

export interface EditsOutcome {
  xml: string;
  /** What was done, in the words `repxEdit` gives. */
  applied: string[];
  /** What was not, each with why. */
  declined: string[];
  changed: boolean;
}

/** More than this many are summarised, so a large report does not cost a large prompt. */
const MAX_CONTROLS = 160;
const MAX_TEXT = 60;
/** A model listing more edits than this is redesigning, which is the other path's job. */
export const MAX_EDITS = 40;

const ROOT = /<XtraReportsLayoutSerializer\b((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*\/?>/;
const attrOf = (attrs: string, name: string): string | null => new RegExp(`\\s${name.replace('.', '\\.')}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? null;
const round = (n: number) => Math.round(n * 100) / 100;
const clip = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat;
};

/** A control's box in the file's own numbers. */
function fileBox(c: PreviewControl) {
  const s = c.dpiScale ?? 1;
  return { x: round((c.fileX ?? c.x) / s), y: round(c.y / s), width: round(c.width / s), height: round(c.height / s) };
}

function fontWords(c: { fontFamily: string | null; fontSize: number | null; bold: boolean; italic: boolean }): string {
  return [c.fontFamily, c.fontSize ? `${round(c.fontSize)}pt` : null, c.bold ? 'bold' : null, c.italic ? 'italic' : null].filter(Boolean).join(' ');
}

/**
 * What a control or cell prints: its field, the expression it prints when
 * that names none (2026-11-07, agent audit item 48: "Page " + [PageNumber],
 * a total's formula), or its own words.
 */
function says(c: { text: string; field: string | null; data?: { expression: string | null } }): string {
  if (c.field) return `[${c.field}]`;
  if (c.data?.expression) return `= ${clip(c.data.expression)}`;
  return c.text.trim() ? `"${clip(c.text)}"` : '';
}

/**
 * The report as its file writes it (2026-11-07, agent audit item 6): a
 * right-to-left report's cells in file order and its positions unmirrored,
 * since the edits name cells and positions as the file does. The Preview
 * draws what prints; the outline and the edits read this.
 */
/*
 * Parsed once per version of the file (2026-11-07, agent audit item 90). A
 * turn read the same REPX three or four times on the main thread: the
 * outline, each edit's search for its control, the Changed list's before
 * and after. The last few versions are kept by their text, which a turn
 * passes from one step to the next unchanged, so each distinct file is
 * parsed once. Nothing here changes what a parse returns; the callers only
 * read it, which is what makes sharing it safe.
 */
const PARSE_CACHE = 6;
const parsed = new Map<string, ReturnType<typeof parseReportStructure>>();
let parses = 0;
const parseAsWritten = (xml: string) => {
  const hit = parsed.get(xml);
  if (hit) {
    // Newest last, so the oldest is the one to go.
    parsed.delete(xml);
    parsed.set(xml, hit);
    return hit;
  }
  parses += 1;
  const s = parseReportStructure(xml, undefined, { asWritten: true });
  parsed.set(xml, s);
  if (parsed.size > PARSE_CACHE) parsed.delete(parsed.keys().next().value as string);
  return s;
};
/** How many times a file has really been parsed here, for the test that holds item 90. */
export const parsesSoFar = () => parses;

/** Whether DevExpress prints the report right to left, its alignments flipped; and mirrored, its layout too. */
function rightToLeftOf(xml: string): { rtl: boolean; mirrored: boolean } {
  const attrs = ROOT.exec(xml)?.[1] ?? '';
  const rtl = attrOf(attrs, 'RightToLeft') === 'Yes';
  return { rtl, mirrored: rtl && attrOf(attrs, 'RightToLeftLayout') === 'Yes' };
}

const flipSide = (a: 'left' | 'center' | 'right') => (a === 'left' ? 'right' : a === 'right' ? 'left' : a);

/** More than this many rows of one table are summarised (agent audit item 43). */
const MAX_ROWS = 10;

/**
 * Every control's name as the outline and the edits use it (2026-11-07,
 * agent audit item 42): its `Name`, and for the second control sharing a
 * name `name#2`, the third `name#3`, in file order, so two controls with one
 * name are told apart and an edit reaches the one meant. Unnamed controls
 * get none.
 */
function keyedControls(bands: PreviewBand[]): { band: number; index: number; c: PreviewControl; key: string }[] {
  const seen = new Map<string, number>();
  const out: { band: number; index: number; c: PreviewControl; key: string }[] = [];
  bands.forEach((band, b) =>
    band.controls.forEach((c, i) => {
      if (!c.name) {
        out.push({ band: b, index: i, c, key: '' });
        return;
      }
      const n = (seen.get(c.name) ?? 0) + 1;
      seen.set(c.name, n);
      out.push({ band: b, index: i, c, key: n === 1 ? c.name : `${c.name}#${n}` });
    }),
  );
  return out;
}

/** What a control's appearance adds to its line: a colour, a fill, borders (agent audit item 10). */
function lookWords(look: Partial<Record<string, string>>): string[] {
  const out: string[] = [];
  const fore = look.ForeColor?.trim();
  if (fore && !/^(Black|0,\s*0,\s*0)$/i.test(fore)) out.push(`colour ${fore}`);
  const back = look.BackColor?.trim();
  if (back && !/^Transparent$/i.test(back)) out.push(`fill ${back}`);
  const borders = look.Borders?.trim();
  if (borders && !/^None$/i.test(borders)) out.push(`borders ${borders}${look.BorderColor ? ` ${look.BorderColor}` : ''}`);
  return out;
}

/** Each control's `AccessibleDescription`, by name, as the file writes it. */
function descriptionsOf(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<Item\d+\b([^>]*\bControlType="XR[^"]*"[^>]*)>/g)) {
    const name = attrOf(m[1], 'Name');
    const said = attrOf(m[1], 'AccessibleDescription');
    if (name && said) out.set(name, said);
  }
  return out;
}

/**
 * The report as the model is shown it. `findings` are the checks' messages,
 * worth fixing when asked; `selected` the controls selected on the Preview
 * (2026-11-05), which "this" and "these" in a message mean.
 */
export function reportOutline(xml: string, options: { findings?: readonly string[]; selected?: readonly string[] } = {}): string {
  const structure = parseAsWritten(xml);
  const rootAttrs = ROOT.exec(xml)?.[1] ?? '';
  const title = /\sDisplayName="([^"]*)"/.exec(rootAttrs)?.[1] ?? /\sName="([^"]*)"/.exec(rootAttrs)?.[1] ?? 'the report';
  const paper = attrOf(rootAttrs, 'PaperKind') ?? 'Letter';
  const landscape = (attrOf(rootAttrs, 'Landscape') ?? '').toLowerCase() === 'true';
  const { rtl, mirrored } = rightToLeftOf(xml);
  const m = structure.margins;
  const lines: string[] = [
    `REPORT "${clip(title)}"; unit ${structure.unit}; paper ${paper} ${landscape ? 'landscape' : 'portrait'}, page ${round(structure.page.width)} x ${round(structure.page.height)}; margins left ${round(m.left)}, right ${round(m.right)}, top ${round(m.top)}, bottom ${round(m.bottom)}.`,
    "Positions and sizes are in the report's unit, as the file writes them; font sizes are points.",
  ];
  if (rtl) {
    lines.push(
      `RIGHT TO LEFT: the report prints right to left. Alignments below are as they print, and an alignment edit is written as it should print.${mirrored ? ' Positions and table cells are as the file writes them, and print mirrored: x is measured from the left as written, and cell 1 prints rightmost.' : ''}`,
    );
  }
  const fields = new Set<string>();
  let listed = 0;
  let unlisted = 0;
  let shared = false;
  const keyed = keyedControls(structure.bands);
  const describedAs = descriptionsOf(xml);
  let at = 0;
  structure.bands.forEach((band, b) => {
    const height = round(band.height / (band.dpiScale ?? 1));
    lines.push(`BAND ${b} ${band.kind} "${band.name}", height ${height}${band.fields.length ? `, grouped by ${band.fields.map((f) => `[${f.field}]`).join(', ')}` : ''}`);
    if (band.sub) lines.push(`  (a detail report: its own bands are not listed and cannot be edited here)`);
    for (const c of band.controls) {
      const key = keyed[at++].key;
      if (key.includes('#')) shared = true;
      if (c.field) fields.add(c.field);
      for (const row of c.rows) for (const cell of row.cells) if (cell.field) fields.add(cell.field);
      if (listed >= MAX_CONTROLS) {
        unlisted++;
        continue;
      }
      listed++;
      const box = fileBox(c);
      // A control inside a panel is placed within it (agent audit item 41).
      const panel = c.panel !== undefined ? band.controls[c.panel] : null;
      const where = panel ? `in panel ${panel.name || '(unnamed)'} at ${box.x},${box.y} within it` : `at ${box.x},${box.y}`;
      const align = rtl ? flipSide(c.align) : c.align;
      const parts = [
        `${key || '(unnamed)'}: ${c.type} ${where} size ${box.width}x${box.height}`,
        says(c),
        c.type === 'XRTable' ? '' : fontWords(c),
        c.type === 'XRTable' ? `${c.rows.length} ${c.rows.length === 1 ? 'row' : 'rows'}` : align,
        ...lookWords(c.appearance),
        c.data?.format ? `format "${c.data.format}"` : '',
        c.data?.running ? (c.data.running === 'None' ? 'a summary with no running scope' : `a total over ${c.data.running === 'Report' ? 'the report' : `each ${c.data.running.toLowerCase()}`}`) : '',
        c.visible ? '' : 'hidden',
        // What the person said the control is for (2026-11-10): "the tax line" finds it.
        describedAs.get(c.name) ? `described as "${clip(describedAs.get(c.name)!)}"` : '',
      ].filter(Boolean);
      lines.push(`  ${parts.join(', ')}`);
      c.rows.slice(0, MAX_ROWS).forEach((row, r) => {
        lines.push(`    row ${r + 1}: ${row.cells.map((cell, k) => `cell ${k + 1} ${says(cell) || '""'}${cell.bold ? ' bold' : ''}`).join(' | ')}`);
      });
      if (c.rows.length > MAX_ROWS) lines.push(`    (${c.rows.length - MAX_ROWS} more rows are not listed)`);
    }
  });
  if (unlisted) lines.push(`(${unlisted} more controls are not listed)`);
  if (shared) lines.push('Some controls share a name: the second is written name#2, the third name#3, and an edit names them the same way.');
  if (fields.size) lines.push(`FIELDS PRINTED: ${[...fields].map((f) => `[${f}]`).join(', ')}`);
  if (structure.parameters.length) lines.push(`PARAMETERS: ${structure.parameters.map((p) => p.name).join(', ')}`);
  if (options.findings?.length) lines.push(`CHECKS FOUND: ${options.findings.slice(0, 8).join(' | ')}`);
  if (options.selected?.length) lines.push(`SELECTED ON THE PREVIEW: ${options.selected.join(', ')}`);
  return lines.join('\n');
}

interface Found {
  ref: ControlRef;
  control: PreviewControl;
}

function findControl(xml: string, name: string | undefined): Found | null {
  if (!name) return null;
  const keyed = keyedControls(parseAsWritten(xml).bands);
  // "name#2" is the second control of that name; a bare name is the first.
  for (const exact of [true, false]) {
    const hit = keyed.find((k) => k.key && (exact ? k.key === name : k.key.toLowerCase() === name.toLowerCase()));
    if (hit) return { ref: { band: hit.band, control: hit.index }, control: hit.c };
  }
  return null;
}

/**
 * The font most of a band's labels print in (2026-11-07, agent audit item
 * 39), for a label added to it with none named; null with no labels.
 */
function bandFont(band: PreviewBand): { family?: string; size?: number } | null {
  const labels = band.controls.filter((c) => c.type === 'XRLabel' && c.fontFamily);
  if (!labels.length) return null;
  const count = new Map<string, { n: number; family: string; size: number | null }>();
  for (const c of labels) {
    const key = `${c.fontFamily}|${c.fontSize}`;
    const seen = count.get(key) ?? { n: 0, family: c.fontFamily!, size: c.fontSize };
    seen.n++;
    count.set(key, seen);
  }
  const top = [...count.values()].sort((a, b) => b.n - a.n)[0];
  return { family: top.family, size: top.size ?? undefined };
}

function findBand(bands: PreviewBand[], key: string | undefined): number {
  if (key === undefined || key === '') return bands.findIndex((b) => b.kind === 'Detail');
  const k = key.trim();
  if (/^\d+$/.test(k)) return Number(k) < bands.length ? Number(k) : -1;
  const lower = k.toLowerCase();
  const byName = bands.findIndex((b) => b.name.toLowerCase() === lower);
  return byName !== -1 ? byName : bands.findIndex((b) => b.kind.toLowerCase() === lower.replace(/\s+/g, ''));
}

const decline = (xml: string, reason: string): EditResult => ({ xml, applied: false, reason });

/**
 * The colours .NET knows by name, as `System.Drawing.Color` spells them: the
 * web colours and Transparent. DevExpress reads a `ForeColor="Red"` through
 * that table, so a name outside it is not a colour (2026-11-07, agent audit
 * item 78: any word of three letters or more was accepted, "Text" included).
 */
const NAMED_COLORS = [
  'AliceBlue', 'AntiqueWhite', 'Aqua', 'Aquamarine', 'Azure', 'Beige', 'Bisque', 'Black', 'BlanchedAlmond', 'Blue', 'BlueViolet', 'Brown',
  'BurlyWood', 'CadetBlue', 'Chartreuse', 'Chocolate', 'Coral', 'CornflowerBlue', 'Cornsilk', 'Crimson', 'Cyan', 'DarkBlue', 'DarkCyan',
  'DarkGoldenrod', 'DarkGray', 'DarkGreen', 'DarkKhaki', 'DarkMagenta', 'DarkOliveGreen', 'DarkOrange', 'DarkOrchid', 'DarkRed', 'DarkSalmon',
  'DarkSeaGreen', 'DarkSlateBlue', 'DarkSlateGray', 'DarkTurquoise', 'DarkViolet', 'DeepPink', 'DeepSkyBlue', 'DimGray', 'DodgerBlue',
  'Firebrick', 'FloralWhite', 'ForestGreen', 'Fuchsia', 'Gainsboro', 'GhostWhite', 'Gold', 'Goldenrod', 'Gray', 'Green', 'GreenYellow',
  'Honeydew', 'HotPink', 'IndianRed', 'Indigo', 'Ivory', 'Khaki', 'Lavender', 'LavenderBlush', 'LawnGreen', 'LemonChiffon', 'LightBlue',
  'LightCoral', 'LightCyan', 'LightGoldenrodYellow', 'LightGray', 'LightGreen', 'LightPink', 'LightSalmon', 'LightSeaGreen', 'LightSkyBlue',
  'LightSlateGray', 'LightSteelBlue', 'LightYellow', 'Lime', 'LimeGreen', 'Linen', 'Magenta', 'Maroon', 'MediumAquamarine', 'MediumBlue',
  'MediumOrchid', 'MediumPurple', 'MediumSeaGreen', 'MediumSlateBlue', 'MediumSpringGreen', 'MediumTurquoise', 'MediumVioletRed',
  'MidnightBlue', 'MintCream', 'MistyRose', 'Moccasin', 'NavajoWhite', 'Navy', 'OldLace', 'Olive', 'OliveDrab', 'Orange', 'OrangeRed',
  'Orchid', 'PaleGoldenrod', 'PaleGreen', 'PaleTurquoise', 'PaleVioletRed', 'PapayaWhip', 'PeachPuff', 'Peru', 'Pink', 'Plum', 'PowderBlue',
  'Purple', 'Red', 'RosyBrown', 'RoyalBlue', 'SaddleBrown', 'Salmon', 'SandyBrown', 'SeaGreen', 'SeaShell', 'Sienna', 'Silver', 'SkyBlue',
  'SlateBlue', 'SlateGray', 'Snow', 'SpringGreen', 'SteelBlue', 'Tan', 'Teal', 'Thistle', 'Tomato', 'Transparent', 'Turquoise', 'Violet',
  'Wheat', 'White', 'WhiteSmoke', 'Yellow', 'YellowGreen',
];
const COLOR_BY_LOWER = new Map(NAMED_COLORS.map((n) => [n.toLowerCase(), n]));

/** `#RRGGBB` as the serializer writes an opaque colour; a colour's name as .NET spells it; else null. */
export function repxColor(value: string): string | null {
  const v = value.trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  // "light grey", "Dark-Blue": the words .NET runs together, grey as gray.
  return COLOR_BY_LOWER.get(v.toLowerCase().replace(/[\s_-]+/g, '').replace(/grey/g, 'gray')) ?? null;
}

/** A `Font` value with the asked-for parts changed and the rest kept. */
function fontValue(current: string | null, resolved: { fontFamily: string | null; fontSize: number | null; bold: boolean; italic: boolean }, e: AgentEdit): string {
  const parts = (current ?? '').split(',').map((p) => p.trim());
  const family = e.family?.trim() || (current ? parts[0] : resolved.fontFamily) || 'Arial';
  const size = e.size && e.size > 0 ? e.size : Number.parseFloat((current ? parts[1] : '') || '') || resolved.fontSize || 9.75;
  const styleText = (/style=([^,]*(?:,\s*(?:Bold|Italic|Underline|Strikeout))*)/i.exec(current ?? '')?.[1] ?? '');
  const has = (s: string) => new RegExp(`\\b${s}\\b`, 'i').test(styleText);
  const bold = e.bold ?? (current ? has('Bold') : resolved.bold);
  const italic = e.italic ?? (current ? has('Italic') : resolved.italic);
  const underline = e.underline ?? has('Underline');
  const strike = has('Strikeout');
  const styles = [bold && 'Bold', italic && 'Italic', underline && 'Underline', strike && 'Strikeout'].filter(Boolean);
  // What follows the style is kept (2026-11-07, agent audit item 89): an
  // Arabic report's "charSet=178" chose its glyphs, and a bold made by the
  // chat dropped it.
  const kept = parts.filter((p) => /^(charSet|gdiCharSet|gdiVerticalFont|unit)=/i.test(p));
  return `${family}, ${round(size)}pt${styles.length ? `, style=${styles.join(', ')}` : ''}${kept.length ? `, ${kept.join(', ')}` : ''}`;
}

/** A style the control names would otherwise win over what is set on it. */
function priority(openTag: string, use: string): Record<string, string> {
  return new RegExp(`\\sStylePriority\\.${use}\\s*=\\s*"false"`, 'i').test(openTag) ? { [`StylePriority.${use}`]: 'true' } : {};
}

const H = { left: 'Left', center: 'Center', right: 'Right' } as const;

/**
 * An alignment as the model may write it (2026-11-05): the first real-key run
 * asked to "centre the footer note" had its edit refused as "no alignment was
 * given", the value not being one of the schema's three words. Any spelling
 * of centre, a DevExpress value ("MiddleRight") or another casing is read; an
 * edit that names none is still refused.
 */
export function readAlign(value: unknown): 'left' | 'center' | 'right' | null {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  if (/cent(er|re)|middle$|^center/.test(v) || v === 'middle') return 'center';
  if (/right|end$/.test(v)) return 'right';
  if (/left|start$/.test(v)) return 'left';
  return null;
}

function alignment(openTag: string, vAlign: 'top' | 'middle' | 'bottom', align: 'left' | 'center' | 'right'): string {
  const current = /\sTextAlignment\s*=\s*"([^"]*)"/.exec(openTag)?.[1] ?? '';
  const vertical = /^(Top|Middle|Bottom)/.exec(current)?.[1] ?? { top: 'Top', middle: 'Middle', bottom: 'Bottom' }[vAlign];
  return `${vertical}${H[align]}`;
}

function styleAttrs(e: AgentEdit, openTag: string, resolved: { fontFamily: string | null; fontSize: number | null; bold: boolean; italic: boolean; vAlign: 'top' | 'middle' | 'bottom' }): Record<string, string> | string {
  if (e.op === 'font') {
    const current = /\sFont\s*=\s*"([^"]*)"/.exec(openTag)?.[1] ?? null;
    return { Font: fontValue(current, resolved, e), ...priority(openTag, 'UseFont') };
  }
  if (e.op === 'color') {
    const attrs: Record<string, string> = {};
    if (e.foreColor) {
      const c = repxColor(e.foreColor);
      if (!c) return `"${e.foreColor}" is not a colour Forma can write`;
      Object.assign(attrs, { ForeColor: c }, priority(openTag, 'UseForeColor'));
    }
    if (e.backColor) {
      const c = repxColor(e.backColor);
      if (!c) return `"${e.backColor}" is not a colour Forma can write`;
      Object.assign(attrs, { BackColor: c }, priority(openTag, 'UseBackColor'));
    }
    return Object.keys(attrs).length ? attrs : 'no colour was given';
  }
  if (e.op === 'align') {
    const side = readAlign(e.align ?? (e as { alignment?: unknown }).alignment);
    if (!side) return 'no alignment was given';
    return { TextAlignment: alignment(openTag, resolved.vAlign, side), ...priority(openTag, 'UseTextAlignment') };
  }
  if (e.op === 'border') {
    const attrs: Record<string, string> = {};
    if (e.borders !== undefined) {
      const sides = borderSides(e.borders);
      if (!sides) return `"${e.borders}" is not a set of sides (All, None, or Left, Top, Right, Bottom)`;
      Object.assign(attrs, { Borders: sides }, priority(openTag, 'UseBorders'));
    }
    if (e.borderColor) {
      const c = repxColor(e.borderColor);
      if (!c) return `"${e.borderColor}" is not a colour Forma can write`;
      Object.assign(attrs, { BorderColor: c }, priority(openTag, 'UseBorderColor'));
    }
    if (e.borderWidth !== undefined) {
      if (!(e.borderWidth >= 0 && e.borderWidth <= 20)) return `${e.borderWidth} is not a border width (0 to 20)`;
      Object.assign(attrs, { BorderWidth: String(round(e.borderWidth)) }, priority(openTag, 'UseBorderWidth'));
    }
    return Object.keys(attrs).length ? attrs : 'no sides, colour or width was given';
  }
  if (e.op === 'format') {
    const format = e.format?.trim() ?? '';
    // A .NET composite format with the value as {0}, which is all TextFormatString takes.
    if (!/\{0(?:[,:][^}]*)?\}/.test(format)) return `"${format}" is not a format: write it with {0}, such as {0:N2}, {0:C2} or {0:dd/MM/yyyy}`;
    return { TextFormatString: format };
  }
  return 'not a style';
}

/** Sides as `BorderSide` writes them: All, None, or the sides in its own order. */
function borderSides(value: string): string | null {
  const words = value.toLowerCase().split(/[\s,|+&]+|\band\b/).map((w) => w.trim()).filter(Boolean);
  if (!words.length) return null;
  if (words.includes('all') || words.includes('box')) return 'All';
  if (words.every((w) => w === 'none' || w === 'no')) return 'None';
  const order = ['Left', 'Top', 'Right', 'Bottom'];
  const chosen = order.filter((s) => words.includes(s.toLowerCase()));
  if (chosen.length !== words.filter((w) => w !== 'and').length) return null;
  return chosen.length === 4 ? 'All' : chosen.join(', ');
}

/** Set, or with null remove, attributes on the report's root. */
function setRootAttributes(xml: string, attrs: Record<string, string | null>): string {
  const root = ROOT.exec(xml);
  if (!root) return xml;
  let tag = root[0];
  for (const [name, value] of Object.entries(attrs)) {
    const existing = new RegExp(`\\s${name}\\s*=\\s*"[^"]*"`);
    // Replacer functions, never the value in a replacement string (2026-11-11, the
    // full audit's PX-02): a `$&` or `$'` in it was read as a pattern and wrote the
    // matched text, or the rest of the tag, into the file.
    if (value === null) tag = tag.replace(existing, '');
    else if (existing.test(tag)) tag = tag.replace(existing, () => ` ${name}="${value}"`);
    else tag = tag.replace(/\s*(\/?)>$/, (_m, close: string) => ` ${name}="${value}"${close}>`);
  }
  return xml.slice(0, root.index) + tag + xml.slice(root.index + root[0].length);
}

function applyOne(xml: string, edit: AgentEdit, hooks: EditHooks = {}): EditResult {
  // An alignment is asked for as it should print; a right-to-left report
  // prints the file's flipped, so the file is written the other way (item 6).
  const side = edit.op === 'align' ? readAlign(edit.align ?? (edit as { alignment?: unknown }).alignment) : null;
  const e: AgentEdit = side && rightToLeftOf(xml).rtl ? { ...edit, align: flipSide(side) } : edit;
  if (e.op === 'data') {
    return hooks.data ? hooks.data(xml, e) : decline(xml, 'no database is shared with the AI, so what the report reads cannot change: attach the database layout and tick "Send names and sample values to the AI" on the Data tab');
  }
  if (e.op === 'group') {
    const field = (e.field ?? '').trim().replace(/^\[|\]$/g, '');
    const total = (e.total ?? '').trim().replace(/^\[|\]$/g, '');
    if (!field || /[[\]"<>]/.test(field)) return decline(xml, e.field ? `"${e.field}" is not a field name` : 'no field was named to group by');
    if (/[[\]"<>]/.test(total)) return decline(xml, `"${e.total}" is not a field name`);
    const grouped = inTheData(xml, field, hooks);
    if (grouped && 'reason' in grouped) return decline(xml, grouped.reason);
    const summed = total ? inTheData(xml, total, hooks) : null;
    if (summed && 'reason' in summed) return decline(xml, summed.reason);
    return addGroupBand(xml, grouped?.name ?? field, total ? { total: summed?.name ?? total } : {});
  }
  if (e.op === 'paper') {
    const paper = SUPPORTED_PAGE_SIZES.find((p) => p.toLowerCase() === (e.paper ?? '').trim().toLowerCase());
    const rootAttrs = ROOT.exec(xml)?.[1] ?? '';
    const current = attrOf(rootAttrs, 'PaperKind') ?? 'Letter';
    /*
     * A paper Forma has no size for, Custom above all, only turns (2026-11-07,
     * agent audit item 12): "make it landscape" looked its size up, found
     * none, and set the page to Letter. Its own size is kept, the sides
     * swapped when the turn changes which is longer.
     */
    if (!e.paper && !SUPPORTED_PAGE_SIZES.includes(current)) {
      const w = Number.parseFloat(attrOf(rootAttrs, 'PageWidth') ?? '');
      const h = Number.parseFloat(attrOf(rootAttrs, 'PageHeight') ?? '');
      if (e.landscape === undefined || !Number.isFinite(w) || !Number.isFinite(h)) return decline(xml, `the paper is ${current}: name a paper (${SUPPORTED_PAGE_SIZES.join(', ')}) or say landscape or portrait`);
      const [nw, nh] = e.landscape === w > h || w === h ? [w, h] : [h, w];
      const out = setRootAttributes(xml, { Landscape: e.landscape ? 'true' : null, PageWidth: String(Math.round(nw)), PageHeight: String(Math.round(nh)) });
      return { xml: out, applied: out !== xml, reason: `turned the ${current} paper ${e.landscape ? 'landscape' : 'portrait'}` };
    }
    const target = paper ?? (e.paper ? null : current);
    if (!target) return decline(xml, `"${e.paper}" is not a paper Forma knows (${SUPPORTED_PAGE_SIZES.join(', ')})`);
    const landscape = e.landscape ?? (attrOf(rootAttrs, 'Landscape') ?? '').toLowerCase() === 'true';
    const size = pageSizeInUnits(target, attrOf(rootAttrs, 'ReportUnit') || 'HundredthsOfAnInch');
    const [w, h] = landscape ? [size.height, size.width] : [size.width, size.height];
    const out = setRootAttributes(xml, {
      PaperKind: target === 'Letter' ? null : target,
      Landscape: landscape ? 'true' : null,
      PageWidth: String(Math.round(w)),
      PageHeight: String(Math.round(h)),
    });
    return { xml: out, applied: out !== xml, reason: `set the paper to ${target}${landscape ? ' landscape' : ''}` };
  }
  if (e.op === 'margins') {
    const rootAttrs = ROOT.exec(xml)?.[1] ?? '';
    // 100 a side when none are written, in the root's own Dpi, whatever the
    // unit: what DevExpress printed (parity row 65), read by the Preview's own rule.
    const [l, r, t, b] = marginsOf(attrOf(rootAttrs, 'Margins'));
    const next = [e.left ?? l, e.right ?? r, e.top ?? t, e.bottom ?? b].map((n) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
    const out = setRootAttributes(xml, { Margins: next.join(', ') });
    return { xml: out, applied: out !== xml, reason: `set the margins to ${next.join(', ')} (left, right, top, bottom)` };
  }
  if (e.op === 'add' || e.op === 'line' || e.op === 'pageNumber' || e.op === 'bandHeight') {
    const structure = parseAsWritten(xml);
    const bands = structure.bands;
    // A page number with no band goes where reports print one: the page footer, else the bottom margin.
    const footer = ['PageFooter', 'BottomMargin'].find((k) => bands.some((band) => band.kind === k));
    const b = findBand(bands, e.band ?? (e.op === 'pageNumber' ? footer : undefined));
    if (b === -1) return decline(xml, `no band "${e.band}"`);
    // The band's own height, as the file writes it (agent audit item 22).
    if (e.op === 'bandHeight') return setBandHeight(xml, b, e.height ?? NaN);
    const s = bands[b].dpiScale ?? 1;
    // The new control's numbers are the file's, as the outline gives them;
    // the inserters take report units and divide by the band's Dpi.
    if (e.op === 'line') {
      const printable = structure.page.width - structure.margins.left - structure.margins.right;
      return addLine(xml, b, (e.x ?? 0) * s, (e.y ?? 0) * s, e.width !== undefined ? e.width * s : printable - (e.x ?? 0) * s, e.borderWidth ?? 1, e.name);
    }
    if (e.op === 'pageNumber') {
      const kind = ['NumberOfTotal', 'Number', 'Total', 'DateTime'].find((k) => k.toLowerCase() === (e.pageInfo ?? 'NumberOfTotal').trim().toLowerCase());
      if (!kind) return decline(xml, `"${e.pageInfo}" is not a page number Forma writes (NumberOfTotal, Number, Total, DateTime)`);
      return addPageInfo(xml, b, (e.x ?? 0) * s, (e.y ?? 0) * s, {
        width: e.width !== undefined ? e.width * s : undefined,
        kind,
        format: e.format?.trim() || (kind === 'NumberOfTotal' ? 'Page {0} of {1}' : undefined),
        align: readAlign(e.align) ?? 'right',
        name: e.name,
      });
    }
    const added = addLabel(xml, b, 0, 0, e.text?.trim() || 'New label', e.name);
    if (!added.applied) return added;
    const name = /"([^"]+)"/.exec(added.reason)?.[1];
    const found = findControl(added.xml, name);
    if (!found) return added;
    const placed = moveControl(added.xml, found.ref, e.x ?? 0, e.y ?? 0);
    const sized = e.width || e.height ? resizeControl(placed.xml, found.ref, e.width ?? found.control.width / s, e.height ?? found.control.height / s) : placed;
    /*
     * Its font: the one asked for, the remembered one App passes (agent audit
     * item 13), or the band's own (item 39), so a label added beside 9pt
     * Tahoma is not Times New Roman, the report's default.
     */
    const own = !e.family && !e.size ? bandFont(bands[b]) : null;
    const font = { family: e.family ?? own?.family, size: e.size ?? own?.size, bold: e.bold, italic: e.italic };
    const styled = name && (font.family || font.size || font.bold !== undefined || font.italic !== undefined)
      ? applyOne(sized.xml, { op: 'font', control: name, ...font })
      : null;
    return { xml: styled?.applied ? styled.xml : sized.xml, applied: true, reason: added.reason };
  }

  const found = findControl(xml, e.control);
  if (!found) return decline(xml, e.control ? `no control is named "${e.control}"` : 'no control was named');
  const { ref, control } = found;
  const box = fileBox(control);
  const cellAt = e.row && e.cell ? { row: e.row - 1, cell: e.cell - 1 } : null;

  switch (e.op) {
    case 'duplicate': {
      // Beside itself, as Ctrl+D makes one; then where it was asked to go.
      const copied = duplicateControl(xml, ref);
      if (!copied.applied || (e.x === undefined && e.y === undefined)) return copied;
      const copy = findControl(copied.xml, /as "([^"]+)"/.exec(copied.reason)?.[1]);
      if (!copy) return copied;
      const at = fileBox(copy.control);
      const moved = moveControl(copied.xml, copy.ref, e.x ?? at.x, e.y ?? at.y);
      return { ...moved, reason: copied.reason };
    }
    case 'bind': {
      const field = (e.field ?? '').trim().replace(/^\[|\]$/g, '');
      if (!field || /[[\]"<>]/.test(field)) return decline(xml, e.field ? `"${e.field}" is not a field name` : 'no field was named');
      if (control.type === 'XRTable' && !cellAt) return decline(xml, `${control.name} is a table: name the row and the cell to bind`);
      // Never a field the data lacks (2026-11-10, batch AG item 24): it would print nothing.
      const known = inTheData(xml, field, hooks);
      if (known && 'reason' in known) return decline(xml, known.reason);
      return bindText(xml, ref, `[${known?.name ?? field}]`, cellAt?.row, cellAt?.cell);
    }
    case 'text':
      if (e.text === undefined) return decline(xml, 'no text was given');
      if (control.type === 'XRTable') {
        if (!cellAt) return decline(xml, `${control.name} is a table: name the row and the cell`);
        return setCellText(xml, ref, cellAt.row, cellAt.cell, e.text);
      }
      if (control.field) return decline(xml, `${control.name} prints the field [${control.field}], so typed text would never show`);
      // Bound to an expression that names no field, it prints the expression,
      // never its own text (agent audit item 48).
      if (control.data?.expression) return decline(xml, `${control.name} prints the expression ${clip(control.data.expression)}, so typed text would never show: change the expression in the Data tab`);
      return setControlText(xml, ref, e.text);
    case 'move':
      return moveControl(xml, ref, e.x ?? box.x, e.y ?? box.y);
    case 'resize':
      return resizeControl(xml, ref, e.width ?? box.width, e.height ?? box.height);
    case 'delete':
      return deleteControl(xml, ref);
    case 'visible':
      return updateControl(xml, ref, () => ({ Visible: e.visible === false ? 'false' : 'true' }), e.visible === false ? 'hid' : 'showed');
    case 'describe': {
      const said = (e.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 125);
      if (!said) return decline(xml, 'no description was given');
      return updateControl(xml, ref, () => ({ AccessibleDescription: said }), 'described');
    }
    case 'font':
    case 'color':
    case 'align':
    case 'border':
    case 'format': {
      const what = { font: 'restyled', color: 'recoloured', align: 'aligned', border: 'bordered', format: 'formatted' }[e.op];
      /*
       * A table's cells (2026-11-07, agent audit items 22 and 40): one cell
       * by its row and place; a row by the row alone, as a header row is
       * styled; a column by the place alone; and with neither, every cell,
       * since a cell's own Font or ForeColor wins over the table's, and bold
       * set on the table alone was reported as made while nothing printed bold.
       */
      if (control.type === 'XRTable') {
        const targets: { row: number; cell: number }[] = [];
        control.rows.forEach((row, r) =>
          row.cells.forEach((_, k) => {
            if ((e.row === undefined || e.row - 1 === r) && (e.cell === undefined || e.cell - 1 === k)) targets.push({ row: r, cell: k });
          }),
        );
        if (!targets.length) return decline(xml, `no ${e.row ? `row ${e.row}` : ''}${e.row && e.cell ? ', ' : ''}${e.cell ? `cell ${e.cell}` : ''} in ${control.name}`);
        let out = xml;
        for (const t of targets) {
          const cell = parseAsWritten(out).bands[ref.band].controls[ref.control].rows[t.row]?.cells[t.cell];
          if (!cell) continue;
          let refusal = '';
          const next = updateCell(out, ref, t.row, t.cell, (openTag) => {
            const attrs = styleAttrs(e, openTag, cell);
            if (typeof attrs === 'string') {
              refusal = attrs;
              return {};
            }
            return attrs;
          }, what);
          if (refusal) return decline(xml, refusal);
          out = next.xml;
        }
        const scope = e.row && e.cell ? `row ${e.row}, cell ${e.cell} of` : e.row ? `row ${e.row} of` : e.cell ? `column ${e.cell} of` : 'every cell of';
        return { xml: out, applied: out !== xml, reason: `${what} ${scope} ${control.name}` };
      }
      let refusal = '';
      const out = updateControl(xml, ref, (openTag) => {
        const attrs = styleAttrs(e, openTag, control);
        if (typeof attrs === 'string') {
          refusal = attrs;
          return {};
        }
        return attrs;
      }, what);
      return refusal ? decline(xml, refusal) : out;
    }
    default:
      return decline(xml, `"${(e as AgentEdit).op}" is not an edit Forma can make`);
  }
}

/*
 * Forma's own actions, which the chat runs when asked (2026-11-05): show a
 * pane, fill the Preview with sample rows, export, or open the DevExpress
 * designer. They run after any edits, against the report those edits left.
 */
/** `undo` (2026-11-07, agent audit item 85): "undo that" takes back the last change, as the corner's Undo does. */
export const TOOL_NAMES = ['show', 'testData', 'export', 'designer', 'undo', 'translate'] as const;
export const PANES = ['mockup', 'preview', 'data', 'spec', 'repx'] as const;
export const EXPORT_FORMATS = ['repx', 'pdf', 'csv', 'xlsx', 'docx', 'rtf', 'html', 'png'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export type Pane = (typeof PANES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface AgentTool {
  name: ToolName;
  /** For `show`. */
  pane?: Pane;
  /** For `export`. */
  format?: ExportFormat;
  /** For `translate` (2026-11-10): the language, as the user named it. */
  language?: string;
}

/** The lists the model's schema is built from, handed to `chatReply` with the outline. */
export const TOOL_LISTS = { names: TOOL_NAMES, panes: PANES, formats: EXPORT_FORMATS } as const;

const PANE_WORDS: Record<Pane, string> = { mockup: 'the Mockup', preview: 'the Preview', data: 'the Data tab', spec: 'the Spec', repx: 'the REPX' };

/**
 * What a tool is doing, a line for the reply. In the present (2026-11-07,
 * agent audit item 38): the reply is written before the tools run, and
 * "exported it as PDF" was said of an export not yet made.
 */
export function toolLine(tool: AgentTool): string {
  switch (tool.name) {
    case 'show':
      return `opening ${PANE_WORDS[tool.pane ?? 'preview']}`;
    case 'testData':
      return 'filling the Preview with sample rows';
    case 'export':
      return `exporting it as ${(tool.format ?? 'repx').toUpperCase()}`;
    case 'designer':
      return 'asking the DevExpress designer on this computer to open it';
    case 'undo':
      return 'taking back the last change';
    case 'translate':
      return `translating its texts into ${tool.language ?? 'the language asked'}`;
  }
}

/** Each export format in the words a person uses for it. */
const EXPORT_WORDS_FOR: Partial<Record<string, string>> = {
  pdf: 'a PDF',
  csv: 'a CSV file',
  xlsx: 'an Excel workbook',
  docx: 'a Word document',
  rtf: 'an RTF file',
  html: 'a web page',
  png: 'a picture',
  repx: 'a .repx file',
};

/**
 * What a tool is doing, as the one sentence a reply says of it (2026-11-11,
 * the full audit's UI3): "Exporting it as a PDF." in place of a **Started**
 * list under the reply, which made a tool turn two accounts of one thing.
 * A translation with no language is empty: it cannot start (App drops it
 * before this is asked), and "into the language you named" was a line no
 * result ever replaced.
 */
export function toolSentence(tool: AgentTool): string {
  switch (tool.name) {
    case 'show':
      return `Opening ${PANE_WORDS[tool.pane ?? 'preview']}.`;
    case 'testData':
      return 'Filling the Preview with sample rows.';
    case 'export':
      return `Exporting it as ${EXPORT_WORDS_FOR[tool.format ?? 'repx'] ?? `a ${String(tool.format).toUpperCase()} file`}.`;
    case 'designer':
      return 'Opening it in the designer.';
    case 'undo':
      return 'Taking back the last change.';
    case 'translate': {
      const language = languageName(tool.language);
      return language ? `Translating it into ${language}.` : '';
    }
  }
}

/**
 * The tools that run only when the person's own words asked for them
 * (2026-11-07, agent audit item 47): a model can be told to export, open the
 * designer or translate by a label inside the report or the picture it reads,
 * and each takes something out of the page. So the person's message decides.
 * Asked for in it, the tool runs at once; brought by the model alone, it is
 * dropped, with a console line, and never drawn as a button (2026-11-11, the
 * full audit's WS-09 and TC-02, the owner's rule that nothing waits on a
 * press: until then it was offered as one, and 9 of 14 ordinary phrasings,
 * "print it", "I want it in Excel", "open it in DevExpress", got a button).
 */
export const ASK_FIRST_TOOLS: readonly ToolName[] = ['export', 'designer', 'translate'];

/** An export asked for in so many words: the verb, or a format named after "as", "in" or "to". */
const EXPORT_WORDS = /\b(export|download|save (it |this |the report )?as|as a (pdf|csv|spreadsheet|workbook|word (document|file)|picture|png|image)|\.?(pdf|xlsx|csv|docx|rtf|html|png|repx)\b)/i;
/*
 * The ordinary phrasings (2026-11-11, TC-02): a verb that takes a file out
 * ("give me an Excel file", "send it to Word", "print it"), or a format named
 * by its own name after "in", "into" or "to" ("I need it in Excel"). The
 * words that are also everyday report words, "image", "picture", "word",
 * "file", count only after such a verb or right after "as a": the review of
 * the first version found "rename the column to Image" and "set the title to
 * Invoice file" running an export the model brought into an ordinary edit.
 */
const EXPORT_PHRASED = new RegExp(
  [
    String.raw`\b(export|download|save|print|send (it|this|the report|me)|give me|get (it|this|me))\b[^.?!]{0,40}\b(pdf|excel|xlsx|spreadsheet|workbook|csv|word|docx|rtf|html|web page|png|image|picture|repx|file)\b`,
    String.raw`\b(in(to)?|to|as an?)\s+(an?\s+|the\s+)?(pdf|excel|xlsx|spreadsheet|workbook|csv|docx|rtf|html|png|repx)\b`,
    String.raw`\bas an?\s+(\w+\s+)?(image|picture|word|file)\b`,
    String.raw`\bprint (it|this|the report)\b`,
  ].join('|'),
  'i',
);
const DESIGNER_WORDS = /\b(designer|devexpress|xtrareports?|visual studio|end-user designer)\b/i;

/** Whether the person's own words ask for a tool, so it may run at once. */
export function askedFor(tool: AgentTool, words: string): boolean {
  switch (tool.name) {
    case 'export':
      return EXPORT_WORDS.test(words) || EXPORT_PHRASED.test(words);
    case 'designer':
      return DESIGNER_WORDS.test(words);
    case 'translate':
      return /\b(translat\w*|locali[sz]\w*)\b/i.test(words) || languageAsked(words) !== null || (!!tool.language && namesLanguage(words, tool.language));
    default:
      return true;
  }
}

/**
 * The tools to run at once, and those dropped: everything the person asked
 * for runs now (`words` is their message), and a guarded tool the model
 * brought on its own is dropped (see ASK_FIRST_TOOLS).
 */
export function splitTools(tools: readonly AgentTool[], words = ''): { now: AgentTool[]; dropped: AgentTool[] } {
  const now: AgentTool[] = [];
  const dropped: AgentTool[] = [];
  for (const t of tools) (!ASK_FIRST_TOOLS.includes(t.name) || askedFor(t, words) ? now : dropped).push(t);
  return { now, dropped };
}

/**
 * The tools to run, once each (agent audit item 38): the same tool asked
 * for twice runs once, and a second pane to show replaces the first.
 */
export function distinctTools(tools: readonly AgentTool[]): AgentTool[] {
  const out: AgentTool[] = [];
  for (const t of tools) {
    if (t.name === 'show') {
      const at = out.findIndex((o) => o.name === 'show');
      if (at !== -1) out.splice(at, 1);
    } else if (out.some((o) => o.name === t.name && o.format === t.format)) continue;
    out.push(t);
  }
  return out;
}

/**
 * What the agent is told for its one more pass (2026-11-07, agent audit item
 * 23): what it asked for that could not be made, and what the checks found
 * that its edits brought. Until then a declined edit offered a whole
 * redesign, and an error an edit brought was reported and left.
 */
export function followUpMessage(declined: readonly string[], brought: readonly string[]): string {
  const parts = ['Forma applied your edits.'];
  if (declined.length) parts.push(`These could not be made:\n${declined.map((d) => `- ${d}`).join('\n')}`);
  if (brought.length) parts.push(`The checks found these errors the edits brought:\n${brought.map((b) => `- ${b}`).join('\n')}`);
  parts.push('If the edits can make what was meant another way, or fix those errors, answer with "edit" and only those edits, against the report as it now is (the outline). Otherwise answer with "answer" and say plainly what could not be done.');
  return parts.join('\n\n');
}

/** A report turn's answer, as `chatReply` hands it over and as Forma acts on it. */
export interface ReportOutcome {
  reply: string;
  wantsReport: boolean;
  /** `new` (2026-11-07): a different report, designed in a project of its own while this one is kept. */
  action: 'answer' | 'edit' | 'rebuild' | 'new';
  edits: AgentEdit[];
  /** Forma's own actions to run, with an answer or after edits; none with a redesign. */
  tools: AgentTool[];
  /** The whole request for a redesign or a new report, from the conversation; absent otherwise. */
  brief?: string;
  /** Tools asked for that Forma could not run, each with why (2026-11-07), for the reply's "Not done". */
  toolsDeclined?: string[];
}

/**
 * A tool as the model wrote it, made runnable or refused with a reason
 * (2026-11-07, agent audit item 82): a "show" with no pane opens the
 * Preview, as `toolLine` always said it would; an export with no format,
 * or one Forma does not make, is refused and said, where it vanished.
 */
function readTool(t: unknown): AgentTool | string | null {
  if (!t || typeof t !== 'object') return null;
  const { name, pane, format } = t as AgentTool;
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return typeof name === 'string' && name ? `"${name}" is not something Forma can do` : null;
  if (name === 'show') return (PANES as readonly string[]).includes(pane ?? '') ? { name, pane } : !pane ? { name, pane: 'preview' } : `there is no "${pane}" pane to show`;
  if (name === 'export') return (EXPORT_FORMATS as readonly string[]).includes(format ?? '') ? { name, format } : `export: ${format ? `Forma does not export ${String(format).toUpperCase()}` : 'no format was named'} (${EXPORT_FORMATS.join(', ')})`;
  // The language kept (2026-11-11, the full audit's CV-01): it was dropped here,
  // so every translation reached App with none and fell back on the words.
  if (name === 'translate') {
    const { language } = t as AgentTool;
    const named = typeof language === 'string' ? language.trim().slice(0, 40) : '';
    return named ? { name, language: named } : { name };
  }
  return { name };
}

/**
 * A report turn's answer as Forma acts on it. An action the schema does not
 * name is read from what came with it: edits mean an edit, nothing means an
 * answer. An edit with no edits listed is a redesign, since the model meant
 * to change something it could not express, unless it came with tools to
 * run, which is an answer that acts. An edit is kept only when its op is one
 * Forma knows, a tool only when its name, pane or format is; `applyEdits`
 * checks the rest.
 */
/**
 * The one side a request names, or null (2026-11-06): "centre the footer"
 * is centre; a request naming two sides, or none, names nothing.
 */
export function sideNamed(message: string): 'left' | 'center' | 'right' | null {
  const words = message.toLowerCase();
  const sides = new Set<'left' | 'center' | 'right'>();
  if (/\b(centre|center|centred|centered|centring|centering|middle)\b/.test(words)) sides.add('center');
  if (/\bright\b/.test(words)) sides.add('right');
  if (/\bleft\b/.test(words)) sides.add('left');
  return sides.size === 1 ? [...sides][0] : null;
}

/**
 * The answer read and checked. With `message`, an alignment edit the model
 * sent with no side takes the one the request names (2026-11-06): the second
 * real-key run asked to "centre the footer note", the model answered with an
 * align edit and no `align` (the schema cannot require it for that op alone),
 * and the edit was declined, which offered a whole redesign for a centring.
 */
const BOOLEAN_FIELDS = ['bold', 'italic', 'underline', 'landscape', 'visible'] as const;
const NUMBER_FIELDS = ['row', 'cell', 'x', 'y', 'width', 'height', 'size', 'left', 'right', 'top', 'bottom', 'borderWidth'] as const;

/**
 * An edit's fields as their types (2026-11-07, agent audit item 16). A model
 * answering with no schema, as a local one may, writes "false" and "12" in
 * quotes, and the string "false" is true: "bold": "false" made text bold, and
 * "visible": "false" showed a hidden control. A value that is neither is dropped.
 */
function coerceEdit(e: AgentEdit): AgentEdit {
  const out: Record<string, unknown> = { ...e };
  for (const k of BOOLEAN_FIELDS) {
    const v = out[k];
    if (typeof v === 'string') out[k] = /^true$/i.test(v.trim()) ? true : /^false$/i.test(v.trim()) ? false : undefined;
  }
  for (const k of NUMBER_FIELDS) {
    const v = out[k];
    if (typeof v === 'string') {
      const n = Number.parseFloat(v);
      out[k] = Number.isFinite(n) ? n : undefined;
    }
  }
  return out as unknown as AgentEdit;
}

export function readReportOutcome(parsed: { reply?: string; action?: string; edits?: unknown; tools?: unknown; brief?: unknown }, message?: string): ReportOutcome {
  const named = message ? sideNamed(message) : null;
  const edits = (Array.isArray(parsed.edits) ? parsed.edits : [])
    .filter((e): e is AgentEdit => Boolean(e) && typeof e === 'object' && (EDIT_OPS as readonly string[]).includes((e as AgentEdit).op))
    .map(coerceEdit)
    .map((e) => (e.op === 'align' && named && !readAlign(e.align ?? (e as { alignment?: unknown }).alignment) ? { ...e, align: named } : e));
  const read = (Array.isArray(parsed.tools) ? parsed.tools : []).map(readTool);
  const tools = distinctTools(read.filter((t): t is AgentTool => !!t && typeof t === 'object')).slice(0, 4);
  const toolsDeclined = read.filter((t): t is string => typeof t === 'string');
  let action: ReportOutcome['action'] =
    parsed.action === 'answer' || parsed.action === 'edit' || parsed.action === 'rebuild' || parsed.action === 'new'
      ? parsed.action
      : edits.length ? 'edit' : 'answer';
  if (action === 'edit' && !edits.length) action = tools.length ? 'answer' : 'rebuild';
  const designs = action === 'rebuild' || action === 'new';
  const brief = designs && typeof parsed.brief === 'string' && parsed.brief.trim() ? parsed.brief.trim() : undefined;
  return {
    reply: parsed.reply || (action === 'answer' && !tools.length ? NOT_FOLLOWED : ''),
    wantsReport: action === 'rebuild',
    action,
    edits: action === 'edit' ? edits : [],
    tools: designs ? [] : tools,
    ...(brief ? { brief } : {}),
    ...(!designs && toolsDeclined.length ? { toolsDeclined } : {}),
  };
}

/** The edits made in order, each against the report as the last one left it. */
export function applyEdits(xml: string, edits: readonly AgentEdit[], hooks: EditHooks = {}): EditsOutcome {
  let current = xml;
  const applied: string[] = [];
  const declined: string[] = [];
  // What the report reads first (2026-11-09): a field the same answer binds may come with it.
  const ordered = [...edits.slice(0, MAX_EDITS)].sort((a, b) => Number(b?.op === 'data') - Number(a?.op === 'data'));
  for (const e of ordered) {
    if (!e || !EDIT_OPS.includes(e.op)) {
      declined.push(`"${e?.op}": not an edit Forma can make`);
      continue;
    }
    const r = applyOne(current, e, hooks);
    if (r.applied) {
      current = r.xml;
      applied.push(r.reason);
    } else {
      declined.push(`${e.op}${e.control ? ` ${e.control}` : ''}: ${r.reason}`);
    }
  }
  if (edits.length > MAX_EDITS) declined.push(`${edits.length - MAX_EDITS} more edits were not made: more than ${MAX_EDITS} is a redesign`);
  return { xml: current, applied, declined, changed: current !== xml };
}

/* ------------------------------------------------------------------ *
 * What changed
 * ------------------------------------------------------------------ */

interface Seen {
  c: PreviewControl;
  band: string;
}

/**
 * Every control by the name the outline gives it (`name#2` for a second of
 * one name, agent audit item 42), as written; until 2026-11-07 a second
 * control of one name overwrote the first here, and the Changed list
 * described the wrong one. A right-to-left report's alignment is as it prints.
 */
function controlsOf(xml: string): Map<string, Seen> {
  const out = new Map<string, Seen>();
  const s = parseAsWritten(xml);
  const { rtl } = rightToLeftOf(xml);
  for (const { band, index, c, key } of keyedControls(s.bands)) {
    out.set(key || `${c.type}@${band}.${index}`, { c: rtl ? { ...c, align: flipSide(c.align) } : c, band: s.bands[band].kind });
  }
  return out;
}

/**
 * A control in a sentence: its name in bold, or its kind when it has none
 * ("the label"). An unnamed control's key is `type@band.index`, and its type
 * was what this said until 2026-11-11 ("moved XRLabel to ..."; the full
 * audit's CV-15).
 */
const named = (key: string, type: string | undefined) => (key.includes('@') ? `the ${plainKind(type)}` : `**${key}**`);

/** A control as a line first mentions it: "label **title**", or "a label" when it has no name. */
function introduced(key: string, type: string | undefined): string {
  const kind = plainKind(type);
  if (!key.includes('@')) return `${kind} ${named(key, type)}`;
  return `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
}

/** A choice in the selection toolbar's Format menu (2026-11-05). */
export type FormatAction = 'bold' | 'italic' | 'larger' | 'smaller' | 'left' | 'center' | 'right';

/**
 * The edits a Format choice makes on the controls selected on Preview, by
 * name (2026-11-05): the toolbar Stitch shows over a selection, made with
 * the chat's own edits so a change is spliced exactly as the chat's are.
 * Bold and italic turn on when any selected control is without, and off
 * when all have it; larger and smaller step each control's own size by two
 * points, from 9 when it names none, and never below 4.
 */
export function formatEdits(xml: string, names: readonly string[], action: FormatAction): AgentEdit[] {
  const found = names.map((n) => findControl(xml, n)?.control).filter((c): c is NonNullable<typeof c> => !!c);
  if (action === 'left' || action === 'center' || action === 'right') return found.map((c) => ({ op: 'align', control: c.name, align: action }));
  if (action === 'bold' || action === 'italic') {
    const on = found.some((c) => !c[action]);
    return found.map((c) => ({ op: 'font', control: c.name, [action]: on }));
  }
  const step = action === 'larger' ? 2 : -2;
  return found.map((c) => ({ op: 'font', control: c.name, size: Math.max(4, round((c.fontSize ?? 9) + step)) }));
}

/**
 * The names of the controls `after` adds or changes against `before`
 * (2026-11-05), for Preview to outline what a request changed when it is
 * shown from the conversation (picked in the request log until 2026-11-08), as Stitch outlines the screens a request
 * changed. Named controls only, and not removed ones: there is nothing left
 * to outline.
 */
export function changedControls(before: string, after: string): string[] {
  if (before === after) return [];
  const a = controlsOf(before);
  const out: string[] = [];
  for (const [key, { c: now }] of controlsOf(after)) {
    if (key.includes('@')) continue;
    const was = a.get(key)?.c;
    // The Preview outlines by the control's own Name, which "name#2" shares.
    const name = key.replace(/#\d+$/, '');
    if (!was) {
      if (!out.includes(name)) out.push(name);
      continue;
    }
    const [p, q] = [fileBox(was), fileBox(now)];
    const differs =
      was.text !== now.text || p.x !== q.x || p.y !== q.y || p.width !== q.width || p.height !== q.height ||
      fontWords(was) !== fontWords(now) || JSON.stringify(was.appearance) !== JSON.stringify(now.appearance) ||
      was.align !== now.align || was.visible !== now.visible || JSON.stringify(was.rows) !== JSON.stringify(now.rows);
    if (differs && !out.includes(name)) out.push(name);
  }
  return out;
}

type Look = {
  fontFamily: string | null;
  fontSize: number | null;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  appearance: Partial<Record<string, string>>;
  field: string | null;
  data?: { expression: string | null; format: string | null };
};

/** The colours a person names, by the red, green and blue the file writes for them. */
const COLOUR_WORDS: Record<string, string> = {
  '0,0,0': 'black',
  '255,255,255': 'white',
  '255,0,0': 'red',
  '0,128,0': 'green',
  '0,255,0': 'bright green',
  '0,0,255': 'blue',
  '255,255,0': 'yellow',
  '255,165,0': 'orange',
  '128,0,128': 'purple',
  '255,192,203': 'pink',
  '165,42,42': 'brown',
  '128,128,128': 'grey',
  '169,169,169': 'dark grey',
  '211,211,211': 'light grey',
  '192,192,192': 'silver',
  '0,0,128': 'navy',
  '128,0,0': 'maroon',
  '0,128,128': 'teal',
  '128,128,0': 'olive',
  '0,255,255': 'cyan',
  '255,0,255': 'magenta',
};

/**
 * A colour as the file writes it, in words (2026-11-11, the full audit's
 * CV-15): "0, 0, 255" is blue, `DarkBlue` is dark blue, and a colour with no
 * common name is its `#RRGGBB`. The reply said "(text 0, 0, 255)" until then,
 * the numbers the serializer writes.
 */
export function colourWords(value: string): string {
  const v = value.trim();
  if (/^[a-z]+$/i.test(v)) return v.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/\bgray\b/g, 'grey');
  const n = v.split(',').map((p) => Number.parseInt(p.trim(), 10));
  if (n.length < 3 || n.length > 4 || n.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return v;
  // Four numbers are alpha, red, green, blue.
  const [alpha, r, g, b] = n.length === 4 ? n : [255, ...n];
  if (alpha === 0) return 'transparent';
  return COLOUR_WORDS[`${r},${g},${b}`] ?? `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** What changed in how a control or a cell prints, a line each: font, colour, borders, alignment, format, binding. */
function lookChanges(name: string, was: Look, now: Look): string[] {
  const out: string[] = [];
  if (fontWords(was) !== fontWords(now)) out.push(`restyled ${name} (${fontWords(now) || 'its default font'})`);
  const [a, b] = [was.appearance, now.appearance];
  // A colour in words, a line for the text and one for the fill (CV-15).
  if (a.ForeColor !== b.ForeColor) out.push(b.ForeColor ? `made ${name} ${colourWords(b.ForeColor)}` : `gave ${name} its default text colour`);
  if (a.BackColor !== b.BackColor) {
    const fill = b.BackColor ? colourWords(b.BackColor) : 'transparent';
    out.push(fill === 'transparent' ? `took the fill off ${name}` : `filled ${name} with ${fill}`);
  }
  if (a.Borders !== b.Borders || a.BorderColor !== b.BorderColor || a.BorderWidth !== b.BorderWidth) out.push(`set the borders of ${name} to ${b.Borders ?? 'None'}`);
  if (was.align !== now.align) out.push(`aligned ${name} ${now.align}`);
  if ((was.data?.format ?? null) !== (now.data?.format ?? null)) out.push(`formatted ${name} as ${now.data?.format ? `"${now.data.format}"` : 'plain'}`);
  if (was.field !== now.field || (was.data?.expression ?? null) !== (now.data?.expression ?? null)) {
    // "unbound", not "bound to nothing" (2026-11-09), which read as a binding made.
    out.push(now.field ? `bound ${name} to [${now.field}]` : now.data?.expression ? `bound ${name} to ${clip(now.data.expression)}` : `unbound ${name}`);
  }
  return out;
}

/** Stands for where a cell's change was made, until it is known whether a row, a column or the cell says it. */
const AT = '\u0000';

/**
 * What changed in a table's cells, merged where the change was the same
 * (2026-11-11, the full audit's CV-15): every cell alike is one line for the
 * table, a row alike one for the row ("made row 1 of **tableHeader** blue"),
 * a column alike one for the column, and the rest a line a cell. A header
 * row made blue read as four lines, "recoloured row 1, cell N of ...", one a
 * cell. More than six lines are one count.
 */
function cellChanges(name: string, was: PreviewControl, now: PreviewControl): string[] {
  const grid: (string[] | null)[][] = now.rows.map((row, r) =>
    row.cells.map((cell, k) => {
      const old = was.rows[r]?.cells[k];
      if (!old) return null;
      const out: string[] = [];
      if (old.text !== cell.text && !cell.field) out.push(`retyped ${AT} to "${clip(cell.text)}"`);
      out.push(...lookChanges(AT, old, cell));
      return out.length ? out : null;
    }),
  );
  const changed = grid.flat().filter((c): c is string[] => !!c).length;
  if (!changed) return [];
  const say = (said: readonly string[], where: string) => said.map((l) => l.split(AT).join(where));
  const alike = (list: readonly (string[] | null)[]) => list.length > 1 && list.every((c) => c && c.join('\n') === list[0]!.join('\n'));
  if (alike(grid.flat())) return say(grid[0][0]!, `every cell of ${name}`);
  const lines: string[] = [];
  const done = new Set<string>();
  grid.forEach((row, r) => {
    if (!alike(row)) return;
    lines.push(...say(row[0]!, `row ${r + 1} of ${name}`));
    row.forEach((_, k) => done.add(`${r},${k}`));
  });
  const columns = Math.max(0, ...grid.map((row) => row.length));
  for (let k = 0; k < columns; k++) {
    const column = grid.map((row) => row[k] ?? null);
    if (grid.length < 2 || grid.some((_, r) => done.has(`${r},${k}`)) || !alike(column)) continue;
    lines.push(...say(column[0]!, `column ${k + 1} of ${name}`));
    grid.forEach((_, r) => done.add(`${r},${k}`));
  }
  grid.forEach((row, r) =>
    row.forEach((cell, k) => {
      if (cell && !done.has(`${r},${k}`)) lines.push(...say(cell, `row ${r + 1}, cell ${k + 1} of ${name}`));
    }),
  );
  // A whole table restyled in different ways is one line, not one per cell.
  return lines.length > 6 ? [`changed ${changed} cells of ${name}`] : lines;
}

/**
 * What differs between two reports, a line each, for a reply: controls added,
 * removed, retyped, moved, resized, restyled, aligned, hidden or shown, a
 * table's cells retyped, and the paper and margins. At most `limit` lines,
 * then a count of the rest.
 */
export function describeChanges(before: string, after: string, limit = 10): string[] {
  if (before === after) return [];
  const lines: string[] = [];
  const a = controlsOf(before);
  const b = controlsOf(after);
  for (const [key, { c, band }] of b) {
    if (!a.has(key)) lines.push(`added ${introduced(key, c.type)} to ${plainBand(band)}${says(c) ? `, ${says(c)}` : ''}`);
  }
  for (const [key, { c }] of a) {
    if (!b.has(key)) lines.push(`removed ${introduced(key, c.type)}`);
  }
  for (const [key, { c: was }] of a) {
    const now = b.get(key)?.c;
    if (!now) continue;
    const name = named(key, was.type);
    if (was.text !== now.text && !now.field) lines.push(`retyped ${name} to "${clip(now.text)}"`);
    const [p, q] = [fileBox(was), fileBox(now)];
    if (p.x !== q.x || p.y !== q.y) lines.push(`moved ${name} to ${q.x}, ${q.y}`);
    if (p.width !== q.width || p.height !== q.height) lines.push(`resized ${name} to ${q.width} x ${q.height}`);
    // Each kind of change in its own words (2026-11-07, agent audit item 50):
    // a colour made red read "restyled labelTitle (Arial 18pt)", the
    // appearance having changed and the font not.
    lines.push(...lookChanges(name, was, now));
    if (was.visible !== now.visible) lines.push(`${now.visible ? 'showed' : 'hid'} ${name}`);
    lines.push(...cellChanges(name, was, now));
  }
  const [ra, rb] = [ROOT.exec(before)?.[1] ?? '', ROOT.exec(after)?.[1] ?? ''];
  const paper = (attrs: string) => `${attrOf(attrs, 'PaperKind') ?? 'Letter'}${(attrOf(attrs, 'Landscape') ?? '').toLowerCase() === 'true' ? ' landscape' : ''}`;
  if (paper(ra) !== paper(rb)) lines.push(`the paper is now ${paper(rb)}`);
  if ((attrOf(ra, 'Margins') ?? '') !== (attrOf(rb, 'Margins') ?? '')) lines.push(`the margins are now ${attrOf(rb, 'Margins') ?? 'the default'}`);
  // A band made taller or shorter (2026-11-07, `bandHeight`).
  const [sa, sb] = [parseAsWritten(before).bands, parseAsWritten(after).bands];
  sb.forEach((band) => {
    const old = sa.find((x) => x.name === band.name);
    const h = (x: PreviewBand) => round(x.height / (x.dpiScale ?? 1));
    if (old && h(old) !== h(band)) lines.push(`set the height of ${band.name} to ${h(band)}`);
    // A band the edit added: a group above all (2026-11-09, the chat's `group`).
    const grouping = band.kind === 'GroupHeader' && band.fields.length ? `, grouping by ${band.fields.map((f) => `[${f.field}]`).join(', ')}` : '';
    if (!old) lines.unshift(`added the band ${band.name}${grouping}`);
  });
  // What the report reads (2026-11-09): the data source the chat or the Data tab wrote.
  const reads = (xml: string) => readRepxDataSources(xml).map((d) => `${d.queries.map((q) => q.name).join(', ')} on connection "${d.connectionName}"`).join('; ');
  const [da, db] = [reads(before), reads(after)];
  if (da !== db) lines.unshift(db ? `the report now reads ${db}` : 'removed the data source');
  if (lines.length > limit) return [...lines.slice(0, limit), `and ${lines.length - limit} more changes`];
  return lines;
}

/**
 * What an audit error means for the person, by its `code` (2026-11-11, the
 * full audit's CV-05): what will go wrong when the report prints or opens,
 * and what to do, with no audit code, standard or control count in it.
 * Exported for the other places a finding reaches the thread.
 */
export const PLAIN_FINDINGS: Readonly<Record<string, string>> = {
  empty: 'No report file came back. Send the request again.',
  truncated: 'The file stops part-way, so the designer will not open it. Send the request again.',
  'item-numbering': 'Some parts of the file are numbered out of order, so the designer may leave them out.',
  'duplicate-ref': 'Some parts of the file share a number, so the designer may leave them out.',
  'report-has-scripts': 'The report carries code that runs when it prints. Open it in the designer only if you trust where it came from.',
  'expression-invalid': 'A value in the report is worked out by an expression that cannot be read, so it will not print.',
  'no-detail-band': 'The report has no section for its records, so no rows will print.',
  'calculated-field-empty': 'A calculated field says nothing to work out, so it prints blank.',
  'calculated-field-duplicate': 'Two calculated fields share a name, so the designer keeps only one.',
  'summary-no-running': 'A total is not set to add anything up, so it prints blank.',
  'summary-group-in-report-footer': 'A total at the end of the report adds up each group instead of the whole report, so it prints blank.',
  'formatting-rule-link-dangling': 'A formatting rule points at nothing, so it does not apply.',
  'crosstab-no-layout': 'A cross-tab has no layout, so it will not print.',
  'connection-has-credentials': "The report keeps a database password inside it. Keep only the connection's name.",
  'query-param-unbound': 'A query needs a value the report never asks for, so it cannot run.',
  'datamember-unknown': 'The report reads a table its data source does not have, so no rows will print.',
  'band-taller-than-page': 'One section is taller than the page, so each record prints on its own sheet.',
  // What Forma's own reading of the page and its print with the page's
  // records find (2026-11-11, the full audit's PL-11b, CC-01, CC-04, CC-05).
  'grid-not-a-table': 'The rows on your page came out as separate texts rather than a table, so they will not repeat for each record.',
  'field-unknown': 'The report groups or sorts by a field your data does not have, so it will not group as drawn.',
  'margins-not-whole': "The page's margins are written in a form the designer drops, so it prints with its own margins instead.",
  'page-size-not-whole': "The page's size is written in a form the designer drops, so it prints on a different size of paper.",
  'prints-extra-pages': 'With the records your page shows, the report prints on more pages than your page has.',
  'clipped-at-margin': 'Some text runs past the right margin, so part of it is cut off or printed on a page of its own.',
  'bound-cell-blank': 'Some values print blank with the records your page shows.',
  'group-collapses': 'The groups do not break where your page does.',
  'total-disagrees-with-page': 'A total works out differently from the figure on your page.',
};

/** A finding in the person's words: its plain sentence, or the general one. */
export function plainFinding(code: string | undefined): string {
  return (code && PLAIN_FINDINGS[code]) || 'Something in the file will not print as drawn; the REPX view lists it.';
}

/**
 * What the checks found, said in the reply (2026-11-05), as an agent reports
 * what is wrong rather than leaving it to a pane nobody opened. After a
 * redesign, everything found; after an edit (`before` given), only what the
 * edit brought. Nothing when nothing was found (2026-11-10, the full audit).
 *
 * Errors only, each in plain words (2026-11-11, the full audit's CV-05):
 * the warnings went into the reply too, and one of them, text under 12pt,
 * fires on nearly every business report, so "1 thing worth checking - 14 of
 * 16 text control(s) are below 12pt ... (AYXRE010 ...)" sat under most
 * replies. Warnings stay in the REPX pane, where they are listed in full.
 * One line for each different sentence, four at most.
 */
export function checksMarkdown(
  after: readonly { severity: string; message: string; code?: string }[],
  before?: readonly { message: string }[],
): string {
  const seen = new Set(before?.map((f) => f.message));
  const found = after.filter((f) => f.severity === 'error' && !seen.has(f.message));
  const said = [...new Set(found.map((f) => plainFinding(f.code)))];
  if (!said.length) return '';
  const lines = said.slice(0, 4).map((s) => `- ${s}`);
  if (said.length > 4) lines.push(`- and ${said.length - 4} more, listed in the REPX view`);
  const count = `${said.length} ${said.length === 1 ? 'thing' : 'things'}`;
  return `**${before ? `This change left ${count} to fix` : `${count.charAt(0).toUpperCase()}${count.slice(1)} to fix`}**\n${lines.join('\n')}`;
}

/**
 * A declined edit as the person reads it (2026-11-11, the full audit's
 * CV-15): without the edit's name, which `applyEdits` puts first for the
 * model's second pass ("color labelX: no control is named "labelX""), and
 * in a sentence of its own. `declined` itself is kept as it is: the model is
 * told it, and the op tells it which edit to make again.
 */
export function plainDeclined(line: string): string {
  const op = new RegExp(`^(?:${EDIT_OPS.join('|')})(?: \\S+)?: (.+)$`).exec(line);
  const reason = (op?.[1] ?? line).trim();
  const missing = /^no control is named "(.+)"$/.exec(reason);
  if (missing) return `I couldn't find a part called "${missing[1]}".`;
  if (/^no control was named$/.test(reason)) return "I couldn't tell which part you meant.";
  if (/changed a moment ago|changed underneath|changed since/i.test(reason)) return 'That part has changed since; try again.';
  if (/not an edit Forma can make/.test(reason)) return "That isn't something I can change in place.";
  const sentence = `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * The reply's account of a turn: what changed, what was asked and not done,
 * and what Forma is doing, the last as plain sentences (`toolSentence`), not
 * a **Started** list (2026-11-11, the full audit's UI3).
 */
export function changesMarkdown(changes: readonly string[], declined: readonly string[] = [], doing: readonly string[] = []): string {
  const parts: string[] = [];
  if (changes.length) parts.push(`**Changed**\n${changes.map((c) => `- ${c}`).join('\n')}`);
  if (declined.length) parts.push(`**Not changed**\n${declined.map((d) => `- ${plainDeclined(d)}`).join('\n')}`);
  if (doing.length) parts.push(doing.join(' '));
  return parts.join('\n\n');
}
