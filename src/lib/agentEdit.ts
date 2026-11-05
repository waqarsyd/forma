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
import { parseReportStructure, type PreviewBand, type PreviewControl } from './reportPreview';
import {
  addLabel,
  deleteControl,
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

/** What the model can ask for. Anything else is a redesign. */
export const EDIT_OPS = ['text', 'move', 'resize', 'font', 'color', 'align', 'delete', 'add', 'paper', 'margins', 'visible'] as const;
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

function says(c: { text: string; field: string | null }): string {
  if (c.field) return `[${c.field}]`;
  return c.text.trim() ? `"${clip(c.text)}"` : '';
}

/**
 * The report as the model is shown it. `findings` are the checks' messages,
 * worth fixing when asked; `selected` the controls selected on the Preview
 * (2026-11-05), which "this" and "these" in a message mean.
 */
export function reportOutline(xml: string, options: { findings?: readonly string[]; selected?: readonly string[] } = {}): string {
  const structure = parseReportStructure(xml);
  const rootAttrs = ROOT.exec(xml)?.[1] ?? '';
  const title = /\sDisplayName="([^"]*)"/.exec(rootAttrs)?.[1] ?? /\sName="([^"]*)"/.exec(rootAttrs)?.[1] ?? 'the report';
  const paper = attrOf(rootAttrs, 'PaperKind') ?? 'Letter';
  const landscape = (attrOf(rootAttrs, 'Landscape') ?? '').toLowerCase() === 'true';
  const m = structure.margins;
  const lines: string[] = [
    `REPORT "${clip(title)}"; unit ${structure.unit}; paper ${paper} ${landscape ? 'landscape' : 'portrait'}, page ${round(structure.page.width)} x ${round(structure.page.height)}; margins left ${round(m.left)}, right ${round(m.right)}, top ${round(m.top)}, bottom ${round(m.bottom)}.`,
    "Positions and sizes are in the report's unit, as the file writes them; font sizes are points.",
  ];
  const fields = new Set<string>();
  let listed = 0;
  let unlisted = 0;
  structure.bands.forEach((band, b) => {
    const height = round(band.height / (band.dpiScale ?? 1));
    lines.push(`BAND ${b} ${band.kind} "${band.name}", height ${height}${band.fields.length ? `, grouped by ${band.fields.map((f) => `[${f.field}]`).join(', ')}` : ''}`);
    if (band.sub) lines.push(`  (a detail report: its own bands are not listed and cannot be edited here)`);
    for (const c of band.controls) {
      if (c.field) fields.add(c.field);
      for (const row of c.rows) for (const cell of row.cells) if (cell.field) fields.add(cell.field);
      if (listed >= MAX_CONTROLS) {
        unlisted++;
        continue;
      }
      listed++;
      const box = fileBox(c);
      const parts = [
        `${c.name || '(unnamed)'}: ${c.type} at ${box.x},${box.y} size ${box.width}x${box.height}`,
        says(c),
        c.type === 'XRTable' ? '' : fontWords(c),
        c.type === 'XRTable' ? `${c.rows.length} ${c.rows.length === 1 ? 'row' : 'rows'}` : c.align,
        c.visible ? '' : 'hidden',
      ].filter(Boolean);
      lines.push(`  ${parts.join(', ')}`);
      c.rows.forEach((row, r) => {
        lines.push(`    row ${r + 1}: ${row.cells.map((cell, k) => `cell ${k + 1} ${says(cell) || '""'}${cell.bold ? ' bold' : ''}`).join(' | ')}`);
      });
    }
  });
  if (unlisted) lines.push(`(${unlisted} more controls are not listed)`);
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
  const bands = parseReportStructure(xml).bands;
  for (const exact of [true, false]) {
    for (let b = 0; b < bands.length; b++) {
      const at = bands[b].controls.findIndex((c) => (exact ? c.name === name : c.name.toLowerCase() === name.toLowerCase()));
      if (at !== -1) return { ref: { band: b, control: at }, control: bands[b].controls[at] };
    }
  }
  return null;
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

/** `#RRGGBB` as the serializer writes an opaque colour; a colour's name as it is. */
export function repxColor(value: string): string | null {
  const v = value.trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  return /^[A-Za-z]{3,30}$/.test(v) ? v : null;
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
  return `${family}, ${round(size)}pt${styles.length ? `, style=${styles.join(', ')}` : ''}`;
}

/** A style the control names would otherwise win over what is set on it. */
function priority(openTag: string, use: string): Record<string, string> {
  return new RegExp(`\\sStylePriority\\.${use}\\s*=\\s*"false"`, 'i').test(openTag) ? { [`StylePriority.${use}`]: 'true' } : {};
}

const H = { left: 'Left', center: 'Center', right: 'Right' } as const;

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
    if (!e.align || !(e.align in H)) return 'no alignment was given';
    return { TextAlignment: alignment(openTag, resolved.vAlign, e.align), ...priority(openTag, 'UseTextAlignment') };
  }
  return 'not a style';
}

/** Set, or with null remove, attributes on the report's root. */
function setRootAttributes(xml: string, attrs: Record<string, string | null>): string {
  const root = ROOT.exec(xml);
  if (!root) return xml;
  let tag = root[0];
  for (const [name, value] of Object.entries(attrs)) {
    const existing = new RegExp(`\\s${name}\\s*=\\s*"[^"]*"`);
    if (value === null) tag = tag.replace(existing, '');
    else if (existing.test(tag)) tag = tag.replace(existing, ` ${name}="${value}"`);
    else tag = tag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
  }
  return xml.slice(0, root.index) + tag + xml.slice(root.index + root[0].length);
}

function applyOne(xml: string, e: AgentEdit): EditResult {
  if (e.op === 'paper') {
    const paper = SUPPORTED_PAGE_SIZES.find((p) => p.toLowerCase() === (e.paper ?? '').trim().toLowerCase());
    const rootAttrs = ROOT.exec(xml)?.[1] ?? '';
    const current = attrOf(rootAttrs, 'PaperKind') ?? 'Letter';
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
    const [l, r, t, b] = (attrOf(rootAttrs, 'Margins') ?? '100, 100, 100, 100').split(',').map((n) => Number(n.trim()));
    const next = [e.left ?? l, e.right ?? r, e.top ?? t, e.bottom ?? b].map((n) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
    const out = setRootAttributes(xml, { Margins: next.join(', ') });
    return { xml: out, applied: out !== xml, reason: `set the margins to ${next.join(', ')} (left, right, top, bottom)` };
  }
  if (e.op === 'add') {
    const bands = parseReportStructure(xml).bands;
    const b = findBand(bands, e.band);
    if (b === -1) return decline(xml, `no band "${e.band}"`);
    const added = addLabel(xml, b, 0, 0, e.text?.trim() || 'New label');
    if (!added.applied) return added;
    const name = /"([^"]+)"/.exec(added.reason)?.[1];
    const found = findControl(added.xml, name);
    if (!found) return added;
    const s = found.control.dpiScale ?? 1;
    // addLabel takes report units and divides by the band's Dpi; the outline's numbers are the file's.
    const placed = moveControl(added.xml, found.ref, e.x ?? 0, e.y ?? 0);
    const sized = e.width || e.height ? resizeControl(placed.xml, found.ref, e.width ?? found.control.width / s, e.height ?? found.control.height / s) : placed;
    return { xml: sized.xml, applied: true, reason: added.reason };
  }

  const found = findControl(xml, e.control);
  if (!found) return decline(xml, e.control ? `no control is named "${e.control}"` : 'no control was named');
  const { ref, control } = found;
  const box = fileBox(control);
  const cellAt = e.row && e.cell ? { row: e.row - 1, cell: e.cell - 1 } : null;

  switch (e.op) {
    case 'text':
      if (e.text === undefined) return decline(xml, 'no text was given');
      if (control.type === 'XRTable') {
        if (!cellAt) return decline(xml, `${control.name} is a table: name the row and the cell`);
        return setCellText(xml, ref, cellAt.row, cellAt.cell, e.text);
      }
      if (control.field) return decline(xml, `${control.name} prints the field [${control.field}], so typed text would never show`);
      return setControlText(xml, ref, e.text);
    case 'move':
      return moveControl(xml, ref, e.x ?? box.x, e.y ?? box.y);
    case 'resize':
      return resizeControl(xml, ref, e.width ?? box.width, e.height ?? box.height);
    case 'delete':
      return deleteControl(xml, ref);
    case 'visible':
      return updateControl(xml, ref, () => ({ Visible: e.visible === false ? 'false' : 'true' }), e.visible === false ? 'hid' : 'showed');
    case 'font':
    case 'color':
    case 'align': {
      const what = e.op === 'font' ? 'restyled' : e.op === 'color' ? 'recoloured' : 'aligned';
      if (control.type === 'XRTable' && cellAt) {
        const cell = control.rows[cellAt.row]?.cells[cellAt.cell];
        if (!cell) return decline(xml, `no cell ${cellAt.cell + 1} in row ${cellAt.row + 1} of ${control.name}`);
        let refusal = '';
        const out = updateCell(xml, ref, cellAt.row, cellAt.cell, (openTag) => {
          const attrs = styleAttrs(e, openTag, cell);
          if (typeof attrs === 'string') {
            refusal = attrs;
            return {};
          }
          return attrs;
        }, what);
        return refusal ? decline(xml, refusal) : out;
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
export const TOOL_NAMES = ['show', 'testData', 'export', 'designer'] as const;
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
}

/** The lists the model's schema is built from, handed to `chatReply` with the outline. */
export const TOOL_LISTS = { names: TOOL_NAMES, panes: PANES, formats: EXPORT_FORMATS } as const;

const PANE_WORDS: Record<Pane, string> = { mockup: 'the Mockup', preview: 'the Preview', data: 'the Data tab', spec: 'the Spec', repx: 'the REPX' };

/** What a tool did, a line for the reply. */
export function toolLine(tool: AgentTool): string {
  switch (tool.name) {
    case 'show':
      return `opened ${PANE_WORDS[tool.pane ?? 'preview']}`;
    case 'testData':
      return 'filled the Preview with sample rows';
    case 'export':
      return `exported it as ${(tool.format ?? 'repx').toUpperCase()}`;
    case 'designer':
      return 'asked the DevExpress designer on this computer to open it';
  }
}

function isTool(t: unknown): t is AgentTool {
  if (!t || typeof t !== 'object') return false;
  const { name, pane, format } = t as AgentTool;
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return false;
  if (name === 'show') return (PANES as readonly string[]).includes(pane ?? '');
  if (name === 'export') return (EXPORT_FORMATS as readonly string[]).includes(format ?? '');
  return true;
}

/** A report turn's answer, as `chatReply` hands it over and as Forma acts on it. */
export interface ReportOutcome {
  reply: string;
  wantsReport: boolean;
  action: 'answer' | 'edit' | 'rebuild';
  edits: AgentEdit[];
  /** Forma's own actions to run, with an answer or after edits; none with a redesign. */
  tools: AgentTool[];
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
export function readReportOutcome(parsed: { reply?: string; action?: string; edits?: unknown; tools?: unknown }): ReportOutcome {
  const edits = (Array.isArray(parsed.edits) ? parsed.edits : []).filter(
    (e): e is AgentEdit => Boolean(e) && typeof e === 'object' && (EDIT_OPS as readonly string[]).includes((e as AgentEdit).op),
  );
  const tools = (Array.isArray(parsed.tools) ? parsed.tools : []).filter(isTool).slice(0, 4);
  let action: ReportOutcome['action'] =
    parsed.action === 'answer' || parsed.action === 'edit' || parsed.action === 'rebuild' ? parsed.action : edits.length ? 'edit' : 'answer';
  if (action === 'edit' && !edits.length) action = tools.length ? 'answer' : 'rebuild';
  return {
    reply: parsed.reply || (action === 'answer' && !tools.length ? 'Sorry — I did not catch that.' : ''),
    wantsReport: action === 'rebuild',
    action,
    edits: action === 'edit' ? edits : [],
    tools: action === 'rebuild' ? [] : tools,
  };
}

/** The edits made in order, each against the report as the last one left it. */
export function applyEdits(xml: string, edits: readonly AgentEdit[]): EditsOutcome {
  let current = xml;
  const applied: string[] = [];
  const declined: string[] = [];
  for (const e of edits.slice(0, MAX_EDITS)) {
    if (!e || !EDIT_OPS.includes(e.op)) {
      declined.push(`"${e?.op}": not an edit Forma can make`);
      continue;
    }
    const r = applyOne(current, e);
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

function controlsOf(xml: string): Map<string, Seen> {
  const out = new Map<string, Seen>();
  const s = parseReportStructure(xml);
  s.bands.forEach((band, b) =>
    band.controls.forEach((c, i) => {
      out.set(c.name || `${c.type}@${b}.${i}`, { c, band: band.kind });
    }),
  );
  return out;
}

const named = (key: string) => (key.includes('@') ? key.split('@')[0] : `**${key}**`);

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
    if (!a.has(key)) lines.push(`added ${c.type.replace(/^XR/, '').toLowerCase()} ${named(key)} to ${band}${says(c) ? `, ${says(c)}` : ''}`);
  }
  for (const [key, { c }] of a) {
    if (!b.has(key)) lines.push(`removed ${c.type.replace(/^XR/, '').toLowerCase()} ${named(key)}`);
  }
  for (const [key, { c: was }] of a) {
    const now = b.get(key)?.c;
    if (!now) continue;
    const name = named(key);
    if (was.text !== now.text && !now.field) lines.push(`retyped ${name} to "${clip(now.text)}"`);
    const [p, q] = [fileBox(was), fileBox(now)];
    if (p.x !== q.x || p.y !== q.y) lines.push(`moved ${name} to ${q.x}, ${q.y}`);
    if (p.width !== q.width || p.height !== q.height) lines.push(`resized ${name} to ${q.width} x ${q.height}`);
    if (fontWords(was) !== fontWords(now) || JSON.stringify(was.appearance) !== JSON.stringify(now.appearance)) {
      lines.push(`restyled ${name}${fontWords(now) ? ` (${fontWords(now)})` : ''}`);
    }
    if (was.align !== now.align) lines.push(`aligned ${name} ${now.align}`);
    if (was.visible !== now.visible) lines.push(`${now.visible ? 'showed' : 'hid'} ${name}`);
    now.rows.forEach((row, r) =>
      row.cells.forEach((cell, k) => {
        const old = was.rows[r]?.cells[k];
        if (old && old.text !== cell.text && !cell.field) lines.push(`retyped row ${r + 1}, cell ${k + 1} of ${name} to "${clip(cell.text)}"`);
        else if (old && (fontWords(old) !== fontWords(cell) || old.align !== cell.align)) lines.push(`restyled row ${r + 1}, cell ${k + 1} of ${name}`);
      }),
    );
  }
  const [ra, rb] = [ROOT.exec(before)?.[1] ?? '', ROOT.exec(after)?.[1] ?? ''];
  const paper = (attrs: string) => `${attrOf(attrs, 'PaperKind') ?? 'Letter'}${(attrOf(attrs, 'Landscape') ?? '').toLowerCase() === 'true' ? ' landscape' : ''}`;
  if (paper(ra) !== paper(rb)) lines.push(`the paper is now ${paper(rb)}`);
  if ((attrOf(ra, 'Margins') ?? '') !== (attrOf(rb, 'Margins') ?? '')) lines.push(`the margins are now ${attrOf(rb, 'Margins') ?? 'the default'}`);
  if (lines.length > limit) return [...lines.slice(0, limit), `and ${lines.length - limit} more changes`];
  return lines;
}

/**
 * What the REPX checks found, said in the reply (2026-11-05), as an agent
 * reports its own checking rather than leaving it to a pane nobody opened.
 * After a redesign, everything found, or that nothing was; after an edit
 * (`before` given), only what the edit brought, and nothing when it brought
 * nothing. Four lines, then a count of the rest.
 */
export function checksMarkdown(after: readonly { severity: string; message: string }[], before?: readonly { message: string }[]): string {
  const seen = new Set(before?.map((f) => f.message));
  const found = before ? after.filter((f) => !seen.has(f.message)) : after;
  if (!found.length) return before ? '' : '**Checked**: the REPX checks found nothing wrong.';
  const lines = found.slice(0, 4).map((f) => `- ${f.severity === 'error' ? 'error: ' : ''}${f.message}`);
  if (found.length > 4) lines.push(`- and ${found.length - 4} more, listed in the REPX pane`);
  return `**${before ? 'The change brought' : 'The checks found'} ${found.length} ${found.length === 1 ? 'problem' : 'problems'}**\n${lines.join('\n')}`;
}

/** The reply's account of a turn: what changed, what was asked and not done, and what Forma did. */
export function changesMarkdown(changes: readonly string[], declined: readonly string[] = [], done: readonly string[] = []): string {
  const parts: string[] = [];
  if (changes.length) parts.push(`**Changed**\n${changes.map((c) => `- ${c}`).join('\n')}`);
  if (declined.length) parts.push(`**Not changed**\n${declined.map((d) => `- ${d}`).join('\n')}`);
  if (done.length) parts.push(`**Done**\n${done.map((d) => `- ${d}`).join('\n')}`);
  return parts.join('\n\n');
}
