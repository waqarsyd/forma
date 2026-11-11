/**
 * What the person's own changes teach Forma (2026-11-11, the full audit's D4).
 *
 * The owner's ask was that the more Forma is used the more it learns, and the
 * plainest thing use says is a correction: Forma made titles 14pt, the person
 * made them 16pt, and kept the report. Once is a report; the same change to
 * the same kind of part in two reports Forma made is a habit, and Forma should
 * stop making them change it. So:
 *
 * - **A kept report is compared with the one Forma made** (`styleOfReport`
 *   on both, `keptCorrections`): for each kind of text (titles, captions,
 *   values, totals) its face, size, weight, alignment and colour, and the
 *   page's margins. Each difference is one entry in a ledger, for the report
 *   Forma made (`ref`), so keeping one report five times is one correction.
 * - **An Undo of what Forma did counts against it** (`undoneCorrections`):
 *   each part it changed, at the value it changed it to, with a weight of -1.
 * - **Two agreeing, a habit** (`learnedPreferences`): a value the ledger
 *   holds for two reports more than against becomes a memory, `source:
 *   'learned'`, shown in Settings under "Learned from your changes" with a
 *   Forget (`learnedMemories`), told to the AI with the other memories and
 *   applied to the house style a described report is given (`withLearned`).
 *
 * Only a part's kind and the value it was set to are kept: never a word of a
 * report, a name or a field. Everything stays in this browser with the rest
 * of the memory (lib/memory.ts). Pure, so it runs under Node in the tests.
 */
import { parseReportStructure, type PreviewControl } from './reportPreview';
import { skeletonOf, type SkeletonFont, type SkeletonRole } from './reportSkeleton';
import { unitsPerInch } from './reportGeometry';
import type { HouseStyle, RoleStyle } from './formaModel';
import type { Memory, MemoryHints } from './memory';

/** What can be corrected: a text's face, size, weight, alignment or colour, or a margin. */
export type CorrectionKind = 'font' | 'size' | 'bold' | 'align' | 'colour' | 'margin';
/** The kind of text a correction is about, or the side a margin is on. */
export type TextPart = 'title' | 'caption' | 'value' | 'total';
export type CorrectionPart = TextPart | 'top' | 'bottom' | 'left' | 'right';

export interface Correction {
  kind: CorrectionKind;
  part: CorrectionPart;
  /** The value it was set to: a face, points, 'bold' or 'regular', an alignment, a colour, or inches. */
  value: string;
  /** +1 for a change the person made and kept, -1 for one Forma made that they undid. */
  weight: 1 | -1;
  /** The report Forma made that it is about: one report counts once, however often it is kept. */
  ref: string;
  at: string;
}

/** The newest corrections the ledger keeps; a few hundred bytes each at most. */
export const MAX_LEDGER = 200;
/** How many reports must agree before a change is a habit. The owner's "twice" (D4). */
export const LEARN_AFTER = 2;

const TEXT_PARTS: readonly TextPart[] = ['title', 'caption', 'value', 'total'];

interface PartStyle {
  font: string;
  size: number;
  bold: boolean;
  align: string;
  colour: string;
}

/** A report's style by kind of text, and its margins in inches. */
export interface ReportStyle {
  parts: Partial<Record<TextPart, PartStyle>>;
  margins: { top: number; bottom: number; left: number; right: number };
}

/** A colour as one spelling: named colours in lower case, "R, G, B" as #rrggbb, unset as black. */
export function colourName(value: string | undefined | null): string {
  const v = (value ?? '').trim();
  if (!v) return 'black';
  const rgb = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(v);
  if (rgb) return `#${rgb.slice(1).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
  return v.toLowerCase().replace(/\s+/g, '');
}

const mode = <T>(xs: T[]): T => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const inches = (v: number, unit: string) => Math.round((v / unitsPerInch(unit)) * 20) / 20;

/**
 * A report's style: for each kind of text, the face most of it is in, its
 * median size, whether most of it is bold, its usual alignment and colour;
 * and the margins. Kinds come from the skeleton (a bound value, a total, a
 * caption, the title), the colours from the parsed controls beside them.
 * Null when the file cannot be read.
 */
export function styleOfReport(repx: string): ReportStyle | null {
  try {
    const s = parseReportStructure(repx);
    const k = skeletonOf(s);
    // Nothing read is no style: its margins of 0 would read as four changes.
    if (!k.bands.length) return null;
    const seen: Record<TextPart, { font: SkeletonFont; align: string; colour: string }[]> = { title: [], caption: [], value: [], total: [] };
    const take = (role: SkeletonRole, font: SkeletonFont | null, align: string, colour: string | undefined) => {
      if (font && (TEXT_PARTS as readonly string[]).includes(role)) seen[role as TextPart].push({ font, align, colour: colourName(colour) });
    };
    s.bands.forEach((band, b) => {
      // skeletonOf keeps the visible controls in order, so the two walk together.
      const shown: PreviewControl[] = band.controls.filter((c) => c.visible);
      shown.forEach((control, i) => {
        const sk = k.bands[b]?.controls[i];
        if (!sk) return;
        if (sk.rows) {
          sk.rows.forEach((row, r) => row.forEach((cell, c) => {
            const pc = control.rows[r]?.cells[c];
            take(cell.role, cell.font ?? sk.font, cell.align, pc?.appearance.ForeColor ?? control.appearance.ForeColor);
          }));
        } else {
          take(sk.role, sk.font, sk.align, control.appearance.ForeColor);
        }
      });
    });
    const parts: ReportStyle['parts'] = {};
    for (const part of TEXT_PARTS) {
      const all = seen[part];
      if (!all.length) continue;
      parts[part] = {
        font: mode(all.map((t) => t.font.family)),
        size: median(all.map((t) => t.font.size)),
        bold: all.filter((t) => t.font.bold).length * 2 > all.length,
        align: mode(all.map((t) => t.align)),
        colour: mode(all.map((t) => t.colour)),
      };
    }
    const m = s.margins;
    return { parts, margins: { top: inches(m.top, s.unit), bottom: inches(m.bottom, s.unit), left: inches(m.left, s.unit), right: inches(m.right, s.unit) } };
  } catch {
    return null;
  }
}

/** Each way `to` differs from `from`, as the value `to` holds. */
function differences(from: ReportStyle, to: ReportStyle): Omit<Correction, 'weight' | 'ref' | 'at'>[] {
  const out: Omit<Correction, 'weight' | 'ref' | 'at'>[] = [];
  for (const part of TEXT_PARTS) {
    const a = from.parts[part];
    const b = to.parts[part];
    if (!a || !b) continue;
    if (a.font.toLowerCase() !== b.font.toLowerCase()) out.push({ kind: 'font', part, value: b.font });
    if (Math.abs(a.size - b.size) > 0.25) out.push({ kind: 'size', part, value: String(Math.round(b.size * 2) / 2) });
    if (a.bold !== b.bold) out.push({ kind: 'bold', part, value: b.bold ? 'bold' : 'regular' });
    if (a.align !== b.align) out.push({ kind: 'align', part, value: b.align });
    if (a.colour !== b.colour) out.push({ kind: 'colour', part, value: b.colour });
  }
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    if (Math.abs(from.margins[side] - to.margins[side]) >= 0.05) out.push({ kind: 'margin', part: side, value: String(to.margins[side]) });
  }
  return out;
}

/** What the person changed between the report Forma made and the one they kept, for that report. */
export function keptCorrections(made: string, kept: string, ref: string, now = new Date()): Correction[] {
  const a = styleOfReport(made);
  const b = styleOfReport(kept);
  if (!a || !b) return [];
  return differences(a, b).map((d) => ({ ...d, weight: 1 as const, ref, at: now.toISOString() }));
}

/** What a change that was undone did, each part at the value it was changed to, counted against. */
export function undoneCorrections(before: string, after: string, ref: string, now = new Date()): Correction[] {
  const a = styleOfReport(before);
  const b = styleOfReport(after);
  if (!a || !b) return [];
  return differences(a, b).map((d) => ({ ...d, weight: -1 as const, ref, at: now.toISOString() }));
}

/**
 * The ledger with `entries` in it: what the same report said before, the same
 * way round, gives way to them, and the newest MAX_LEDGER are kept.
 */
export function recordCorrections(ledger: readonly Correction[], entries: readonly Correction[]): Correction[] {
  if (!entries.length) return [...ledger];
  const replaced = new Set(entries.map((e) => `${e.ref}|${e.weight}`));
  return [...ledger.filter((e) => !replaced.has(`${e.ref}|${e.weight}`)), ...entries].slice(-MAX_LEDGER);
}

/** A habit: a value for one kind of part, and how many reports more said it than undid it. */
export interface LearnedPreference {
  kind: CorrectionKind;
  part: CorrectionPart;
  value: string;
  net: number;
}

/**
 * The habits in a ledger: for each kind of part, the value the most reports
 * agree on, once at least LEARN_AFTER more agree than undid it. A report
 * counts once for a value whichever way it is counted, however often.
 */
export function learnedPreferences(ledger: readonly Correction[]): LearnedPreference[] {
  const tally = new Map<string, { kind: CorrectionKind; part: CorrectionPart; value: string; up: Set<string>; down: Set<string>; at: string }>();
  for (const e of ledger) {
    const key = `${e.kind}|${e.part}|${e.value}`;
    const t = tally.get(key) ?? { kind: e.kind, part: e.part, value: e.value, up: new Set<string>(), down: new Set<string>(), at: e.at };
    (e.weight > 0 ? t.up : t.down).add(e.ref);
    if (e.at > t.at) t.at = e.at;
    tally.set(key, t);
  }
  const best = new Map<string, LearnedPreference & { at: string }>();
  for (const t of tally.values()) {
    const net = t.up.size - t.down.size;
    if (net < LEARN_AFTER) continue;
    const slot = `${t.kind}|${t.part}`;
    const held = best.get(slot);
    if (!held || net > held.net || (net === held.net && t.at > held.at)) best.set(slot, { kind: t.kind, part: t.part, value: t.value, net, at: t.at });
  }
  return [...best.values()].map(({ at: _at, ...p }) => p);
}

const PLURAL: Record<TextPart, string> = { title: 'Titles', caption: 'Captions and column headings', value: 'Values', total: 'Totals' };
const ALIGNED: Record<string, string> = { left: 'aligned left', center: 'centred', right: 'aligned right' };

/** A habit as the memory says it, in the words Settings shows and the AI is told. */
export function learnedText(p: Pick<LearnedPreference, 'kind' | 'part' | 'value'>): string {
  if (p.kind === 'margin') return `${p.part.charAt(0).toUpperCase()}${p.part.slice(1)} margin of ${p.value} inch`;
  const who = p.kind === 'font' && p.part === 'value' ? 'Text' : PLURAL[p.part as TextPart];
  switch (p.kind) {
    case 'font': return `${who} in ${p.value}`;
    case 'size': return `${who} at ${p.value}pt`;
    case 'bold': return `${who} ${p.value === 'bold' ? 'in bold' : 'not bold'}`;
    case 'align': return `${who} ${ALIGNED[p.value] ?? `aligned ${p.value}`}`;
    default: return `${who} in ${p.value}`;
  }
}

/** What Forma's own model can apply of a habit; the rest the AI is told in words. */
function learnedHints(p: LearnedPreference): MemoryHints {
  if (p.kind === 'font' && p.part === 'value') return { fontFamily: p.value };
  if (!(TEXT_PARTS as readonly string[]).includes(p.part)) return {};
  const part = p.part as TextPart;
  if (p.kind === 'size') return { sizes: { [part]: Number(p.value) } as MemoryHints['sizes'] };
  if (p.kind === 'bold') return { bold: { [part]: p.value === 'bold' } as MemoryHints['bold'] };
  return {};
}

/** The id a learned memory has: one per kind of part, so a newer habit replaces an older one. */
export const learnedId = (kind: CorrectionKind, part: CorrectionPart) => `learned-${kind}-${part}`;

/**
 * The memories with what the ledger has learned: the person's own memories
 * as they are, then one learned memory per habit. A learned memory whose
 * words have not changed keeps its switch, so one switched off stays off;
 * one the ledger no longer holds (undone since) goes.
 */
export function learnedMemories(memories: readonly Memory[], prefs: readonly LearnedPreference[], now = new Date()): Memory[] {
  const own = memories.filter((m) => m.source !== 'learned');
  const before = new Map(memories.filter((m) => m.source === 'learned').map((m) => [m.id, m]));
  const learned = prefs.map((p): Memory => {
    const id = learnedId(p.kind, p.part);
    const text = learnedText(p);
    const held = before.get(id);
    if (held && held.text === text) return held;
    return { id, text, source: 'learned', created: now.toISOString(), enabled: true, hints: learnedHints(p) };
  });
  return [...own, ...learned];
}

/**
 * The ledger without what one learned memory was counted from, for its
 * Forget: forgotten, it comes back only from two new reports, not from the
 * ones it was learned from.
 */
export function forgetLearned(ledger: readonly Correction[], memoryId: string): Correction[] {
  return ledger.filter((e) => learnedId(e.kind, e.part) !== memoryId);
}

/**
 * A house style with the learned habits switched on written into it (2026-11-11,
 * D4): a role's face, size and weight, and the margins in hundredths of an
 * inch, as `houseStyleBrief` reads them. Alignment and colour have no place
 * in a house style; the AI is told those in words with the other memories.
 */
export function withLearned(style: HouseStyle, memories: readonly Memory[]): HouseStyle {
  const learned = memories.filter((m) => m.source === 'learned' && m.enabled);
  if (!learned.length) return style;
  const out: HouseStyle = { ...style, roles: { ...style.roles }, margins: { ...style.margins }, fonts: [...style.fonts] };
  const face = out.fonts[0]?.family ?? 'Arial';
  const role = (part: TextPart): RoleStyle => (out.roles[part] = { ...(out.roles[part] ?? { family: face, size: part === 'title' ? 14 : 9, bold: part === 'value' ? 0 : 1 }) });
  for (const m of learned) {
    const [, kind, part] = /^learned-(\w+)-(\w+)$/.exec(m.id) ?? [];
    const value = learnedValue(m.text, kind as CorrectionKind);
    if (value === null) continue;
    if (kind === 'font' && (TEXT_PARTS as readonly string[]).includes(part)) {
      role(part as TextPart).family = value;
      if (part === 'value') out.fonts = [{ family: value, share: 1 }, ...out.fonts.filter((f) => f.family !== value)];
    } else if (kind === 'size' && (TEXT_PARTS as readonly string[]).includes(part)) role(part as TextPart).size = Number(value);
    else if (kind === 'bold' && (TEXT_PARTS as readonly string[]).includes(part)) role(part as TextPart).bold = value === 'bold' ? 1 : 0;
    else if (kind === 'margin') {
      const paper = out.papers[0]?.paper;
      if (paper) {
        const m0 = out.margins[paper] ?? { top: 100, bottom: 100, left: 100, right: 100 };
        out.margins[paper] = { ...m0, [part]: Math.round(Number(value) * 100) };
      }
    }
  }
  return out;
}

/** The value a learned memory's words hold, read back from `learnedText`'s own phrasing. */
function learnedValue(text: string, kind: CorrectionKind): string | null {
  const m =
    kind === 'font' ? / in (.+)$/.exec(text)
    : kind === 'size' ? / at ([\d.]+)pt$/.exec(text)
    : kind === 'bold' ? (/ in bold$/.test(text) ? [text, 'bold'] : / not bold$/.test(text) ? [text, 'regular'] : null)
    : kind === 'margin' ? / of ([\d.]+) inch$/.exec(text)
    : null;
  return m ? m[1] : null;
}
