/**
 * What Forma works out for itself instead of asking (2026-11-04).
 *
 * The owner's rule: a user should not be asked what the input already says.
 * The Report configuration dialog asked for the DevExpress version, the page
 * size, the unit, a header and footer, right to left and a stored procedure,
 * and two of those were actively harmful: the header and footer defaults went
 * into every prompt as "Include Company Logo: No" and "Include Page Numbers:
 * Yes", overruling the very source being reproduced.
 *
 * So each setting is read from what the user sent, in this order:
 * 1. **A report**: an uploaded `.repx`, or the report already open when the
 *    request refines it. It names its own SerializerVersion, ReportUnit,
 *    PaperKind, RightToLeft and data source, and it is the truth.
 * 2. **The pages**: a PDF page's size in points is exact; a picture that is a
 *    whole page has the shape of its paper (`paperOfImage`).
 * 3. **The words**: "on A4", "landscape", "EXEC dbo.Sales", and text in an
 *    Arabic or Hebrew script, typed or read by OCR.
 * 4. **What was learned**: the version and unit of the last report the user
 *    brought, kept as their standing preference.
 * 5. **Defaults**, last: the paper of the user's region (Letter in the
 *    Americas that use it, A4 elsewhere) and DevExpress's own unit.
 *
 * Pure, and tested in autoConfig.test.ts.
 */
import { SUPPORTED_PAGE_SIZES, isSupportedPageSize, paperInches, paperOfImage } from './reportGeometry';

/** What was worked out for one request, with why, for the console. */
export interface DetectedSettings {
  version: string;
  unit: string;
  pageSize: string;
  rtl: boolean;
  spName?: string;
  reasons: string[];
}

/** What a report says about itself. Every field absent when it does not say. */
export interface RepxFacts {
  version?: string;
  unit?: string;
  pageSize?: string;
  landscape?: boolean;
  rtl?: boolean;
  spName?: string;
}

const UNITS = ['HundredthsOfAnInch', 'TenthsOfAMillimeter', 'Pixels'];

/** DevExpress's default unit for a new report. */
export const DEFAULT_UNIT = 'HundredthsOfAnInch';

/** The root element's attributes, or '' when there is no root. */
function rootAttrs(xml: string): string {
  return /<XtraReportsLayoutSerializer\b([^>]*)>/.exec(xml)?.[1] ?? '';
}

const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

/** A stored procedure named in a report's data source, which DevExpress keeps base64-encoded in ComponentStorage. */
function procedureIn(xml: string): string | undefined {
  const named = (text: string) => /<ProcName>\s*([^<\s][^<]*?)\s*<\/ProcName>/.exec(text)?.[1];
  const plain = named(xml);
  if (plain) return plain;
  for (const m of xml.matchAll(/\bBase64="([A-Za-z0-9+/=]{16,})"/g)) {
    try {
      const found = named(atob(m[1]));
      if (found) return found;
    } catch {
      /* not base64 after all */
    }
  }
  return undefined;
}

/** What a report says about its version, unit, paper, direction and data source. */
export function repxFacts(xml: string | null | undefined): RepxFacts {
  const attrs = rootAttrs(xml ?? '');
  if (!attrs) return {};
  const facts: RepxFacts = {};
  const version = /^(\d{2}\.\d)/.exec(attr(attrs, 'SerializerVersion') ?? attr(attrs, 'Version') ?? '')?.[1];
  if (version) facts.version = version;
  const unit = attr(attrs, 'ReportUnit');
  if (unit && UNITS.includes(unit)) facts.unit = unit;
  const kind = attr(attrs, 'PaperKind');
  if (kind && isSupportedPageSize(kind)) facts.pageSize = kind;
  else if (!kind && (attr(attrs, 'PageWidth') || attr(attrs, 'PageHeight'))) facts.pageSize = 'Letter';
  const landscape = attr(attrs, 'Landscape');
  if (landscape) facts.landscape = landscape.toLowerCase() === 'true';
  const rtl = attr(attrs, 'RightToLeft');
  if (rtl) facts.rtl = /^(yes|true)$/i.test(rtl);
  const proc = procedureIn(xml ?? '');
  if (proc) facts.spName = proc;
  return facts;
}

/** The paper of a PDF page from its size in points, within 2%, or null. */
export function paperFromPoints(points: { width: number; height: number }): string | null {
  const [short, long] = [Math.min(points.width, points.height), Math.max(points.width, points.height)];
  for (const paper of SUPPORTED_PAGE_SIZES) {
    const inches = paperInches(paper)!;
    if (Math.abs(short / (inches.w * 72) - 1) <= 0.02 && Math.abs(long / (inches.h * 72) - 1) <= 0.02) return paper;
  }
  return null;
}

/**
 * A paper named in words, or null. A4 and Tabloid are only ever paper; "letter"
 * and "legal" are ordinary words, so they count only beside a paper word
 * ("letter size", "legal paper") or as "US Letter" / "on legal".
 */
const PAPER_WORDS: readonly [string, RegExp][] = [
  ['A4', /\bA4\b/i],
  ['Tabloid', /\btabloid\b/i],
  ['Legal', /\blegal[-\s]+(?:size|paper|sheet)s?\b|\b(?:us|on)\s+legal\b/i],
  ['Letter', /\bletter[-\s]+(?:size|paper|sheet)s?\b|\b(?:us|on)\s+letter\b/i],
];

export function paperFromWords(text: string): string | null {
  return PAPER_WORDS.find(([, words]) => words.test(text))?.[0] ?? null;
}

/**
 * Regions that use Letter. Everywhere else uses A4, which is ISO 216 and the
 * paper of most of the world.
 */
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'CR', 'DO', 'GT', 'PA', 'PR', 'SV', 'NI', 'BZ']);

/** The paper of the user's region, from a BCP 47 tag such as en-US or ar-AE. */
export function paperForLocale(locale: string | null | undefined): string {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale ?? '')?.[1]?.toUpperCase();
  if (!region) return 'Letter';
  return LETTER_REGIONS.has(region) ? 'Letter' : 'A4';
}

/** Arabic (with Urdu and Persian), Hebrew and Syriac letters. */
const RTL_LETTER = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/g;
const ANY_LETTER = /\p{L}/gu;

/**
 * Whether a text is written right to left: most of its letters in a right-to-left
 * script. A bilingual page (Arabic beside English) counts once its Arabic is
 * at least two fifths of the letters, which is what makes the report's layout
 * mirrored in practice.
 */
export function isRightToLeftText(text: string): boolean {
  const letters = text.match(ANY_LETTER)?.length ?? 0;
  if (letters < 12) return false;
  return (text.match(RTL_LETTER)?.length ?? 0) / letters >= 0.4;
}

/** A stored procedure named in a description or a pasted schema: EXEC x, CREATE PROCEDURE x, "stored procedure x". */
export function procedureFromWords(text: string): string | undefined {
  const m =
    /\bCREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\s+([\w.[\]]+)/i.exec(text) ??
    /\bEXEC(?:UTE)?\s+([\w.[\]]+)/i.exec(text) ??
    /\bstored\s+procedure\s+[`"']?([A-Za-z_][\w.[\]]*)/i.exec(text);
  return m?.[1].replace(/[[\]]/g, '');
}

/** One page sent: a picture's size in pixels, and a PDF page's size in points when it is one. */
export interface SourcePage {
  width: number;
  height: number;
  pagePoints?: { width: number; height: number };
}

export interface DetectInput {
  /** Uploaded reports, and the report being refined. The first that says a thing wins. */
  repx?: readonly (string | null | undefined)[];
  pages?: readonly SourcePage[];
  /** The user's words and the text read from the pages. */
  text?: string;
  /** `navigator.language`. */
  locale?: string;
  /** The version and unit learned from the last report the user brought. */
  learned?: { version?: string; unit?: string };
}

/**
 * A config with the worked-out settings laid over it. The stored direction and
 * stored procedure are replaced too, not merged: a request that names neither
 * gets neither, whatever an earlier one had.
 */
export function applyDetected<T extends { version: string; unit: string; pageSize: string; rtl?: boolean; spName?: string }>(
  config: T,
  detected: DetectedSettings,
): T {
  return { ...config, version: detected.version, unit: detected.unit, pageSize: detected.pageSize, rtl: detected.rtl, spName: detected.spName };
}

/** Every setting, worked out from what was sent; see the header for the order. */
export function detectSettings(input: DetectInput): DetectedSettings {
  const reasons: string[] = [];
  const facts = (input.repx ?? []).map(repxFacts);
  const first = <K extends keyof RepxFacts>(key: K): RepxFacts[K] | undefined => facts.find((f) => f[key] !== undefined)?.[key];
  const text = input.text ?? '';

  let version = first('version');
  if (version) reasons.push(`version ${version} from the report`);
  else {
    version = input.learned?.version || '23.2';
    reasons.push(`version ${version}, since this request brings no report to read one from`);
  }

  let unit = first('unit');
  if (unit) reasons.push(`unit ${unit} from the report`);
  else {
    unit = input.learned?.unit && UNITS.includes(input.learned.unit) ? input.learned.unit : DEFAULT_UNIT;
    reasons.push(`unit ${unit}`);
  }

  let pageSize = first('pageSize');
  if (pageSize) reasons.push(`paper ${pageSize} from the report`);
  if (!pageSize) {
    for (const page of input.pages ?? []) {
      const paper = page.pagePoints ? paperFromPoints(page.pagePoints) : paperOfImage(page);
      if (paper) {
        pageSize = paper;
        reasons.push(`paper ${paper} from the ${page.pagePoints ? "PDF page's size" : "picture's shape"}`);
        break;
      }
    }
  }
  if (!pageSize) {
    const named = paperFromWords(text);
    if (named) {
      pageSize = named;
      reasons.push(`paper ${named} as the words say`);
    }
  }
  if (!pageSize) {
    pageSize = paperForLocale(input.locale);
    reasons.push(`paper ${pageSize}, the paper of ${input.locale || 'this region'}`);
  }

  let rtl = first('rtl');
  if (rtl !== undefined) reasons.push(rtl ? 'right to left, as the report is' : 'left to right, as the report is');
  else {
    rtl = isRightToLeftText(text);
    if (rtl) reasons.push('right to left: the text is in a right-to-left script');
  }

  const spName = first('spName') ?? procedureFromWords(text);
  if (spName) reasons.push(`stored procedure ${spName}`);

  return { version, unit, pageSize, rtl, ...(spName ? { spName } : {}), reasons };
}
