/**
 * The accessibility checks DevExpress's own designer runs, asked of a report
 * here.
 *
 * ## Where they come from
 *
 * On 2026-10-28 the Web Report Designer demo was captured loading (REA,
 * `capture_browser_scenario`), and its second request to the server was
 * `actionKey=getDesignErrors` with the whole layout attached. The response was
 * a list of findings with codes, each carrying a message and a remediation
 * sentence; on DevExpress's own master-detail demo it returned 67 of them under
 * four codes:
 *
 *   AYXRE001  contrast ratio of text and background below 4.5:1 (3:1 for large text)
 *   AYXRE010  text below 12pt for body text, 16pt for headings
 *   AYXRE011  line spacing below 1.5x the font size, paragraph spacing below 2-3x
 *   AYXRE300  image, diagram or other visual element with no alternative text
 *
 * Those are WCAG's text rules, applied to a report, and DevExpress runs them on
 * every edit. Three of the four are computable from a REPX and are implemented
 * here. **Line spacing is deliberately not**: an XRLabel carries no line- or
 * paragraph-spacing property in the file, so whatever DevExpress measures for
 * AYXRE011 is derived from something this module cannot see, and a check that
 * guessed would fail on exactly the reports it was meant to help.
 *
 * ## Why they are warnings, and why one per report
 *
 * None of these stop a report opening or lose content, so by the audit's own
 * rule (`repxAudit.ts`, *Errors versus warnings*) they are warnings. They are
 * also recommendations with a known cost in noise: a dense invoice table at 9pt
 * is a legitimate design choice that WCAG's 12pt body rule still flags, and
 * DevExpress flagged 25 such cells on its own demo. So each check produces ONE
 * finding per report, with the count and the worst few names, rather than one
 * per control. The user sees that the report has a contrast problem and where
 * to start, not thirty lines saying the same thing.
 *
 * ## What is resolved and what is not
 *
 * Appearance in a REPX is inherited: a cell with no `Font` takes its row's,
 * the row its table's, the table its band's, the band the report's, and after
 * `repxStyles.ts` has run a control's appearance may live in a `<StyleSheet>`
 * entry it names by `StyleName`. The walk below resolves all of that, in the
 * order DevExpress does (own attribute, then style, then parent), so the
 * check reads the same values the designer would paint with.
 *
 * What it does not do is assume. A report with no `Font` declared anywhere is
 * not measured for text size, and a control whose colours are both absent is
 * black on white and passes; a colour written as a name this module does not
 * know is left unjudged rather than guessed. An unknown is not a failure.
 */
import type { RepxFinding } from './repxAudit';

/** WCAG 1.4.3: 4.5:1 for ordinary text, 3:1 for large text (18pt, or 14pt bold). */
export const MIN_CONTRAST = 4.5;
export const MIN_CONTRAST_LARGE = 3;
export const LARGE_TEXT_PT = 18;
export const LARGE_BOLD_PT = 14;
/** DevExpress's AYXRE010 threshold for body text. */
export const MIN_BODY_PT = 12;

/** Controls whose text is read, and so whose size and contrast matter. */
const TEXT_CONTROLS = new Set(['XRLabel', 'XRTableCell', 'XRCheckBox', 'XRPageInfo', 'XRCharacterComb']);

/** Controls that are visual rather than textual, and so need alternative text (AYXRE300). */
const VISUAL_CONTROLS = new Set(['XRPictureBox', 'XRBarCode', 'XRChart', 'XRShape', 'XRGauge', 'XRSparkline']);

export interface Rgb { r: number; g: number; b: number }

/**
 * The named colours DevExpress writes most often. Anything else parses as
 * unknown and the control is left unjudged.
 */
const NAMED: Record<string, Rgb> = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 128, b: 0 },
  lime: { r: 0, g: 255, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  navy: { r: 0, g: 0, b: 128 },
  maroon: { r: 128, g: 0, b: 0 },
  yellow: { r: 255, g: 255, b: 0 },
  orange: { r: 255, g: 165, b: 0 },
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  dimgray: { r: 105, g: 105, b: 105 },
  darkgray: { r: 169, g: 169, b: 169 },
  silver: { r: 192, g: 192, b: 192 },
  lightgray: { r: 211, g: 211, b: 211 },
  gainsboro: { r: 220, g: 220, b: 220 },
  whitesmoke: { r: 245, g: 245, b: 245 },
  darkblue: { r: 0, g: 0, b: 139 },
  darkgreen: { r: 0, g: 100, b: 0 },
  darkred: { r: 139, g: 0, b: 0 },
  controltext: { r: 0, g: 0, b: 0 },
  window: { r: 255, g: 255, b: 255 },
};

/**
 * Parse a REPX colour: `255,69,77,103` (A,R,G,B as DevExpress writes it),
 * `69,77,103` (R,G,B), or a name. `Transparent` and a zero alpha are `null`
 * meaning "see through to the parent"; a partial alpha is `undefined`,
 * meaning the blend is not computed and the control is left unjudged.
 */
export function parseColor(value: string | null | undefined): Rgb | null | undefined {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!text) return null;
  const parts = text.split(',').map((p) => Number(p.trim()));
  if (parts.length === 3 || parts.length === 4) {
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return undefined;
    if (parts.length === 4) {
      const [a, r, g, b] = parts;
      if (a === 0) return null;
      if (a < 255) return undefined;
      return { r, g, b };
    }
    const [r, g, b] = parts;
    return { r, g, b };
  }
  const key = text.toLowerCase();
  if (key === 'transparent' || key === 'empty') return null;
  return NAMED[key];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. */
export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1..21, independent of which colour is the text. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface FontSpec { size: number | null; bold: boolean }

/** `Arial, 9.75pt, style=Bold` as DevExpress writes it. Size is null when absent. */
export function parseFont(value: string | null | undefined): FontSpec | null {
  if (!value) return null;
  const size = /,\s*(\d+(?:\.\d+)?)pt/.exec(value);
  return { size: size ? Number(size[1]) : null, bold: /style=[^,]*Bold/i.test(value) };
}

interface Appearance {
  fore?: Rgb | null | undefined;
  back?: Rgb | null | undefined;
  font?: FontSpec | null;
}

const attrOf = (attrs: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

/** Only the attributes the walk reads, from one element's attribute string. */
function appearanceOf(attrs: string): Appearance {
  const out: Appearance = {};
  const fore = attrOf(attrs, 'ForeColor');
  const back = attrOf(attrs, 'BackColor');
  const font = attrOf(attrs, 'Font');
  if (fore !== null) out.fore = parseColor(fore);
  if (back !== null) out.back = parseColor(back);
  if (font !== null) out.font = parseFont(font);
  return out;
}

/** The `<StyleSheet>` entries by name, for controls that reference one by `StyleName`. */
function styleSheetOf(xml: string): Map<string, Appearance> {
  const styles = new Map<string, Appearance>();
  const block = /<StyleSheet>([\s\S]*?)<\/StyleSheet>/.exec(xml);
  if (!block) return styles;
  for (const item of block[1].matchAll(/<Item\d+\b([^>]*)\/?>/g)) {
    const name = attrOf(item[1], 'Name');
    if (name) styles.set(name, appearanceOf(item[1]));
  }
  return styles;
}

interface Frame {
  type: string | null;
  name: string;
  fore: Rgb | null | undefined;
  back: Rgb | null | undefined;
  font: FontSpec | null;
  /** Whether any ancestor or the control itself declared a size. */
  sizeDeclared: boolean;
  colorDeclared: boolean;
}

/** Resolve a control's effective appearance from its own attributes, its style and its parent. */
function resolve(parent: Frame, attrs: string, styles: Map<string, Appearance>): Frame {
  const own = appearanceOf(attrs);
  const styleName = attrOf(attrs, 'StyleName');
  const style = styleName ? styles.get(styleName) : undefined;

  const pick = <T>(a: T | undefined, b: T | undefined, c: T): T => (a !== undefined ? a : b !== undefined ? b : c);

  const fore = pick(own.fore, style?.fore, parent.fore);
  // A transparent background shows the parent's, so null falls through.
  const ownBack = own.back === null ? undefined : own.back;
  const styleBack = style?.back === null ? undefined : style?.back;
  const back = pick(ownBack, styleBack, parent.back);
  const fontCandidate = own.font !== undefined ? own.font : style?.font;
  const font: FontSpec | null = fontCandidate
    ? { size: fontCandidate.size ?? parent.font?.size ?? null, bold: fontCandidate.bold }
    : parent.font;

  return {
    type: attrOf(attrs, 'ControlType'),
    name: attrOf(attrs, 'Name') ?? '',
    fore,
    back,
    font,
    sizeDeclared: parent.sizeDeclared || !!(fontCandidate && fontCandidate.size !== null),
    colorDeclared: parent.colorDeclared || own.fore !== undefined || own.back !== undefined || !!style?.fore || !!style?.back,
  };
}

interface Issue { name: string; detail: string; value: number }

/**
 * Walk the document's `<ItemN>` tree, resolving inherited appearance, and
 * collect the three kinds of finding.
 */
export function auditAccessibility(xml: string): RepxFinding[] {
  const text = xml ?? '';
  if (!text.trim()) return [];

  const styles = styleSheetOf(text);
  const rootAttrs = /<XtraReportsLayoutSerializer\b([^>]*)>/.exec(text)?.[1] ?? '';
  const rootAppearance = appearanceOf(rootAttrs);
  const root: Frame = {
    type: 'XtraReport',
    name: 'report',
    fore: rootAppearance.fore ?? { r: 0, g: 0, b: 0 },
    back: rootAppearance.back ?? { r: 255, g: 255, b: 255 },
    font: rootAppearance.font ?? null,
    sizeDeclared: !!(rootAppearance.font && rootAppearance.font.size !== null),
    colorDeclared: rootAppearance.fore !== undefined || rootAppearance.back !== undefined,
  };

  const contrast: Issue[] = [];
  const small: Issue[] = [];
  const noAlt: string[] = [];
  let textControls = 0;

  const stack: Frame[] = [root];
  // Open tags, self-closing tags and close tags of ItemN elements, plus the
  // style sheet and storages which are skipped as a block.
  const token = /<(\/?)(Item\d+)\b([^>]*?)(\/?)>|<(StyleSheet|ObjectStorage|ComponentStorage|ImageResources|Extensions)>[\s\S]*?<\/\5>/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(text)) !== null) {
    if (m[5]) continue; // a skipped block
    const closing = m[1] === '/';
    const attrs = m[3] ?? '';
    const selfClosing = m[4] === '/';

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const parent = stack[stack.length - 1];
    const type = attrOf(attrs, 'ControlType');
    // Items with no ControlType are collection members (fields, bindings,
    // rows of a cross-tab); they carry no appearance and inherit nothing worth
    // resolving, but they still open and close.
    const frame = type ? resolve(parent, attrs, styles) : parent;

    if (type && TEXT_CONTROLS.has(type)) {
      textControls += 1;
      judgeText(frame, contrast, small);
    } else if (type && VISUAL_CONTROLS.has(type)) {
      if (attrOf(attrs, 'AccessibleDescription') === null && attrOf(attrs, 'AccessibleRole') === null) {
        noAlt.push(frame.name || type);
      }
    }

    if (!selfClosing) stack.push(frame);
  }

  const findings: RepxFinding[] = [];
  const names = (issues: Issue[], render: (i: Issue) => string) =>
    issues
      .slice()
      .sort((a, b) => a.value - b.value)
      .slice(0, 4)
      .map(render)
      .join(', ');

  if (contrast.length) {
    findings.push({
      severity: 'warning',
      code: 'a11y-contrast',
      message:
        `${contrast.length} of ${textControls} text control(s) have text-to-background contrast below WCAG's ` +
        `${MIN_CONTRAST}:1 (${MIN_CONTRAST_LARGE}:1 for large text) — worst: ` +
        `${names(contrast, (i) => `${i.name} at ${i.value.toFixed(1)}:1 (${i.detail})`)}. ` +
        'DevExpress\'s own design analyzer flags the same (AYXRE001). Darken the text or lighten the background.',
    });
  }

  if (small.length) {
    findings.push({
      severity: 'warning',
      code: 'a11y-text-size',
      message:
        `${small.length} of ${textControls} text control(s) are below ${MIN_BODY_PT}pt — smallest: ` +
        `${names(small, (i) => `${i.name} at ${i.value}pt`)}. ` +
        'DevExpress\'s own design analyzer flags the same (AYXRE010: 12pt body, 16pt headings). ' +
        'A dense table is a judgement call; a report read on screen or by low-vision readers is not.',
    });
  }

  if (noAlt.length) {
    findings.push({
      severity: 'warning',
      code: 'a11y-alt-text',
      message:
        `${noAlt.length} visual control(s) carry no AccessibleDescription: ${noAlt.slice(0, 5).join(', ')}` +
        `${noAlt.length > 5 ? ', …' : ''}. A screen reader and a tagged PDF export have nothing to say for them. ` +
        'Set AccessibleDescription (125 characters or fewer), or AccessibleRole for a decorative element (AYXRE300).',
    });
  }

  return findings;
}

function judgeText(frame: Frame, contrast: Issue[], small: Issue[]): void {
  const size = frame.font?.size ?? null;
  const bold = frame.font?.bold ?? false;

  if (frame.sizeDeclared && size !== null && size < MIN_BODY_PT) {
    small.push({ name: frame.name, detail: '', value: size });
  }

  // Both colours resolved to something computable, and at least one was
  // declared somewhere: black on white by default is not worth reporting.
  if (frame.colorDeclared && frame.fore && frame.back) {
    const ratio = contrastRatio(frame.fore, frame.back);
    const large = size !== null && (size >= LARGE_TEXT_PT || (bold && size >= LARGE_BOLD_PT));
    const minimum = large ? MIN_CONTRAST_LARGE : MIN_CONTRAST;
    if (ratio < minimum) {
      const hex = (c: Rgb) => '#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('');
      contrast.push({ name: frame.name, detail: `${hex(frame.fore)} on ${hex(frame.back)}`, value: ratio });
    }
  }
}
