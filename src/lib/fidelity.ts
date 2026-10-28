/**
 * Measure a generated report against what its source was expected to produce.
 *
 * Until 2026-10-28 nothing in this project measured whether a generated report
 * resembled the document it was generated from. The suite covers parsers and
 * repairs; prompt changes were "verified by reading", and the owner's standing
 * complaint about inconsistency took weeks to pin to one reproducible cause (a
 * ruled grid coming back as a table or as 23 labels depending on whether the
 * request happened to say "table" -- see *A cheat sheet is not an instruction*
 * in docs/notes/gemini.md). A prompt or model change today can only be felt.
 *
 * This module is the arithmetic for a benchmark that makes it measurable. Given
 * the two artifacts a generation produces, it reads out the facts a human would
 * check by eye -- which bands exist, how many tables and labels, which of the
 * source's phrases survived, what the font sizes are, whether the margin was
 * declared, what the audit still finds -- and compares them with a case file's
 * expectations. The runner that calls Gemini, renders sources and writes the
 * scorecard is `scripts/fidelity/run.ts`; it spends the owner's quota and so
 * lives outside the suite. Everything here is pure and under test.
 *
 * Two deliberate limits. There is no pixel comparison: a REPX cannot be rendered
 * without DevExpress, and a mockup drawn from the layout is the model's own
 * account of itself. And the checks are coarse on purpose -- a band present or
 * absent, a phrase found or lost, a median inside a range. Those are the
 * failures that have actually happened here, and a coarse check that trips is
 * worth more than a precise one nobody can keep calibrated.
 */
import { parseReportStructure, decodeXmlText } from './reportPreview';
import { auditRepx } from './repxAudit';
import { checkRepxComplete } from './repxTruncation';
import type { ReportLayout } from './reportTypes';

/** What a case file may ask of a generation. Every field is optional. */
export interface FidelityExpectations {
  /** Content band kinds that must each appear at least once, e.g. `Detail`. */
  bands?: string[];
  /** How many `XRTable` controls, inclusive bounds. */
  tables?: { min?: number; max?: number };
  /** Per `ControlType`, inclusive bounds on how many appear. Absent means 0. */
  controls?: Record<string, { min?: number; max?: number }>;
  /**
   * Phrases from the source that must survive into `Text` attributes. Matched
   * case-insensitively with whitespace collapsed. `minRatio` is the fraction of
   * `all` that must be found, default 1.
   */
  texts?: { all: string[]; minRatio?: number };
  /** Bounds on the median font size, in points, across every `Font` written. */
  fontSize?: { median?: { min?: number; max?: number } };
  /** Whether the root `Margins` must be something other than all zeros. */
  margins?: { declared?: boolean };
  /** Audit outcome on the finished file. */
  audit?: { errors?: number; maxWarnings?: number };
  /** Whether `layout.sections.length` must equal the number of content bands. */
  sectionsMatchBands?: boolean;
  /** The exact root `SerializerVersion`, e.g. `20.1.3.0`. */
  serializerVersion?: string;
}

export interface FidelityMeasurements {
  /** `checkRepxComplete` on the file: did the model finish writing it. */
  complete: boolean;
  serializerVersion: string | null;
  unit: string;
  page: { width: number; height: number };
  /** The root `Margins`, in report units, or null when the attribute is absent. */
  margins: { left: number; right: number; top: number; bottom: number } | null;
  /** Content band kind to count. TopMargin and BottomMargin are excluded. */
  bands: Record<string, number>;
  /** Content band kinds in file order, one entry per band. */
  bandOrder: string[];
  /** `ControlType` to count, across every band, panel children included. */
  controls: Record<string, number>;
  tables: number;
  tableCells: number;
  /** Every `Text` attribute in the document, decoded, in document order. */
  texts: string[];
  /** Every point size found in a `Font` attribute, in document order. */
  fontSizesPt: number[];
  fontMedianPt: number | null;
  audit: { errors: number; warnings: number; codes: string[] };
  /** `layout.sections.length`, or null when no layout was given. */
  layoutSections: number | null;
  /** Non-fatal parse complaints from the structure reader. */
  problems: string[];
}

export interface FidelityCheck {
  /** Stable, e.g. `band:Detail`, `texts`, `audit.errors`. */
  id: string;
  pass: boolean;
  expected: string;
  actual: string;
}

const MARGIN_BANDS = new Set(['TopMargin', 'BottomMargin']);

function rootAttributes(xml: string): Record<string, string> {
  const open = /<XtraReportsLayoutSerializer\b([^>]*)>/.exec(xml);
  const attrs: Record<string, string> = {};
  if (!open) return attrs;
  for (const m of open[1].matchAll(/([A-Za-z_][\w.]*)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

function parseMargins(value: string | undefined): FidelityMeasurements['margins'] {
  if (value === undefined) return null;
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [left, right, top, bottom] = parts;
  return { left, right, top, bottom };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Collapse whitespace and case, so a phrase matches however the model wrapped it. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Read every fact the checks below can ask about out of the two artifacts.
 *
 * Never throws: an empty or unparseable document measures as having no bands
 * and no controls, with the reader's complaints in `problems`, which is what a
 * truncated or malformed generation should score as rather than crash the run.
 */
export function measureReport(repxContent: string | null | undefined, layout?: ReportLayout | null): FidelityMeasurements {
  const xml = repxContent ?? '';
  const structure = parseReportStructure(xml);
  const root = rootAttributes(xml);

  const bands: Record<string, number> = {};
  const bandOrder: string[] = [];
  const controls: Record<string, number> = {};
  let tables = 0;
  let tableCells = 0;

  for (const band of structure.bands) {
    if (MARGIN_BANDS.has(band.kind)) continue;
    bands[band.kind] = (bands[band.kind] ?? 0) + 1;
    bandOrder.push(band.kind);
    for (const control of band.controls) {
      controls[control.type] = (controls[control.type] ?? 0) + 1;
      if (control.type === 'XRTable') {
        tables += 1;
        for (const row of control.rows) tableCells += row.cells.length;
      }
    }
  }

  /*
   * `Text` and `TextFormatString` both. A page number is an `XRPageInfo` whose
   * visible words live in `TextFormatString="Page {0} of {1}"` and whose `Text`
   * is empty, so a case asking for the phrase "Page" was failing against a
   * report that printed it -- found on the first baseline run, 2026-10-28.
   */
  const texts: string[] = [];
  for (const m of xml.matchAll(/\b(?:Text|TextFormatString)="([^"]*)"/g)) texts.push(decodeXmlText(m[1]));

  const fontSizesPt: number[] = [];
  for (const m of xml.matchAll(/\bFont="[^"]*?,\s*(\d+(?:\.\d+)?)pt/g)) fontSizesPt.push(Number(m[1]));

  const audit = auditRepx(xml, layout ?? null);

  return {
    complete: checkRepxComplete(xml).complete,
    serializerVersion: root.SerializerVersion ?? null,
    unit: structure.unit,
    page: structure.page,
    margins: parseMargins(root.Margins),
    bands,
    bandOrder,
    controls,
    tables,
    tableCells,
    texts,
    fontSizesPt,
    fontMedianPt: median(fontSizesPt),
    audit: { errors: audit.errors, warnings: audit.warnings, codes: audit.findings.map((f) => f.code) },
    layoutSections: layout ? layout.sections.length : null,
    problems: structure.problems,
  };
}

function inRange(value: number, bounds: { min?: number; max?: number } | undefined): boolean {
  if (!bounds) return true;
  if (bounds.min !== undefined && value < bounds.min) return false;
  if (bounds.max !== undefined && value > bounds.max) return false;
  return true;
}

function describeRange(bounds: { min?: number; max?: number } | undefined): string {
  if (!bounds) return 'any';
  if (bounds.min !== undefined && bounds.max !== undefined) return `${bounds.min}..${bounds.max}`;
  if (bounds.min !== undefined) return `>= ${bounds.min}`;
  if (bounds.max !== undefined) return `<= ${bounds.max}`;
  return 'any';
}

/**
 * Compare measurements with a case's expectations.
 *
 * Always begins with `complete`, whatever the case asks: a half-written file
 * can pass every structural check it happens to reach, and the first thing a
 * reader of the scorecard needs to know is whether the artifact was finished.
 */
export function checkFidelity(m: FidelityMeasurements, expect: FidelityExpectations): FidelityCheck[] {
  const checks: FidelityCheck[] = [];
  checks.push({ id: 'complete', pass: m.complete, expected: 'finished REPX', actual: m.complete ? 'finished' : 'truncated' });

  for (const kind of expect.bands ?? []) {
    const count = m.bands[kind] ?? 0;
    checks.push({ id: `band:${kind}`, pass: count >= 1, expected: 'present', actual: count ? `${count}` : 'absent' });
  }

  if (expect.tables) {
    checks.push({ id: 'tables', pass: inRange(m.tables, expect.tables), expected: describeRange(expect.tables), actual: `${m.tables}` });
  }

  for (const [type, bounds] of Object.entries(expect.controls ?? {})) {
    const count = m.controls[type] ?? 0;
    checks.push({ id: `control:${type}`, pass: inRange(count, bounds), expected: describeRange(bounds), actual: `${count}` });
  }

  if (expect.texts) {
    const haystack = normalizeText(m.texts.join(' \n '));
    const missing = expect.texts.all.filter((phrase) => !haystack.includes(normalizeText(phrase)));
    const found = expect.texts.all.length - missing.length;
    const ratio = expect.texts.all.length ? found / expect.texts.all.length : 1;
    const minRatio = expect.texts.minRatio ?? 1;
    checks.push({
      id: 'texts',
      pass: ratio >= minRatio,
      expected: `>= ${Math.round(minRatio * 100)}% of ${expect.texts.all.length} phrases`,
      actual: missing.length
        ? `${found}/${expect.texts.all.length}, missing: ${missing.map((p) => JSON.stringify(p)).join(', ')}`
        : `${found}/${expect.texts.all.length}`,
    });
  }

  if (expect.fontSize?.median) {
    const pass = m.fontMedianPt !== null && inRange(m.fontMedianPt, expect.fontSize.median);
    checks.push({
      id: 'fontSize.median',
      pass,
      expected: `${describeRange(expect.fontSize.median)}pt`,
      actual: m.fontMedianPt === null ? 'no Font written' : `${m.fontMedianPt}pt over ${m.fontSizesPt.length}`,
    });
  }

  if (expect.margins?.declared !== undefined) {
    const declared = !!m.margins && (m.margins.left || m.margins.right || m.margins.top || m.margins.bottom) !== 0;
    checks.push({
      id: 'margins.declared',
      pass: declared === expect.margins.declared,
      expected: expect.margins.declared ? 'non-zero Margins' : 'zero Margins',
      actual: m.margins ? `${m.margins.left}, ${m.margins.right}, ${m.margins.top}, ${m.margins.bottom}` : 'no Margins attribute',
    });
  }

  if (expect.audit?.errors !== undefined) {
    checks.push({
      id: 'audit.errors',
      pass: m.audit.errors === expect.audit.errors,
      expected: `${expect.audit.errors}`,
      actual: m.audit.errors ? `${m.audit.errors} (${m.audit.codes.join(', ')})` : '0',
    });
  }
  if (expect.audit?.maxWarnings !== undefined) {
    checks.push({
      id: 'audit.warnings',
      pass: m.audit.warnings <= expect.audit.maxWarnings,
      expected: `<= ${expect.audit.maxWarnings}`,
      actual: m.audit.warnings ? `${m.audit.warnings} (${m.audit.codes.join(', ')})` : '0',
    });
  }

  if (expect.sectionsMatchBands) {
    const contentBands = m.bandOrder.length;
    checks.push({
      id: 'sectionsMatchBands',
      pass: m.layoutSections !== null && m.layoutSections === contentBands,
      expected: 'layout.sections == content bands',
      actual: `${m.layoutSections ?? 'no layout'} sections, ${contentBands} bands`,
    });
  }

  if (expect.serializerVersion !== undefined) {
    checks.push({
      id: 'serializerVersion',
      pass: m.serializerVersion === expect.serializerVersion,
      expected: expect.serializerVersion,
      actual: m.serializerVersion ?? 'absent',
    });
  }

  return checks;
}

export interface FidelityScore {
  passed: number;
  total: number;
  /** 0..1, or 1 for an empty list so a case with no checks reads as harmless. */
  ratio: number;
}

export function scoreChecks(checks: FidelityCheck[]): FidelityScore {
  const passed = checks.filter((c) => c.pass).length;
  return { passed, total: checks.length, ratio: checks.length ? passed / checks.length : 1 };
}
