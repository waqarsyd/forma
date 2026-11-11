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
 * Two deliberate limits. There is no pixel comparison: a mockup drawn from the
 * layout is the model's own account of itself. And the checks are coarse on
 * purpose -- a band present or absent, a phrase found or lost, a median inside
 * a range. Those are the failures that have actually happened here, and a
 * coarse check that trips is worth more than a precise one nobody can keep
 * calibrated.
 *
 * ## What prints, not only what the file declares (2026-11-11, CC-02)
 *
 * This header said a REPX "cannot be rendered without DevExpress" until the
 * full audit's Claude Code reference, which printed three cases through
 * DevExpress with the records their sources show and found the score and the
 * print disagreeing on all three: 16/16 for a two-page invoice titled "INVO",
 * 12/12 for a source that throws when printed, 16/16 for a margin of 248.3%,
 * and a faithful 6.72pt body failing a median of 8 to 12 while +34% passed.
 * Forma's own `paginate` is pure TypeScript and runs here. So a case may carry
 * `data.json`, the page's own records (`CaseData`), mapped onto whatever
 * fields a run binds (`rowsForReport`, through `fieldMatch.ts`), and the
 * report is printed with them (`printReport`): `print` checks its pages, what
 * runs past the margin, the text it prints and how many groups break, and
 * `texts` reads the printed text as well, so a caption built by an expression
 * counts. `fontSize.relative` compares with the source's own size, and
 * `margins.loaded` asks for the four whole numbers DevExpress keeps. In Node
 * nothing measures text, so a print here does not grow; `run.ts --probe`
 * puts DevExpress's own print beside it where DevExpress is installed.
 */
import { parseReportStructure, decodeXmlText, paginate, type RecordValues } from './reportPreview';
import { auditRepx, fieldsNamedAfterText } from './repxAudit';
import { checkRepxComplete } from './repxTruncation';
import type { ReportLayout } from './reportTypes';
import { readBoundFields } from './repxBindingPlan';
import { readRepxDataSources } from './repxSqlDataSource';
import { wholeMarginsWritten } from './repxMargins';
import { matchColumns, type FieldEvidence } from './fieldMatch';

/**
 * The records a case's source page shows (`data.json` beside `case.json`),
 * every value as text exactly as the data holds it, so a decimal keeps its
 * scale ("45.0"). `types` names each column's .NET type (`DateTime`,
 * `Decimal`, `Int32`, `Double`, `Boolean`, `String`), as DevExpress reads it.
 */
export interface CaseData {
  types?: Record<string, string>;
  rows: Record<string, string>[];
}

/** A .NET type, as `typeRows` takes it for the print. */
const TYPE_HINT: Record<string, string> = {
  DateTime: 'date',
  Date: 'date',
  Decimal: 'decimal',
  Int16: 'int',
  Int32: 'int',
  Int64: 'int',
  Double: 'double',
  Single: 'double',
  Boolean: 'bool',
  String: 'string',
};

const FIELD_TYPE: Record<string, FieldEvidence['type']> = { date: 'date', decimal: 'number', int: 'number', double: 'number', bool: 'boolean', string: 'string' };

/** Every `FieldName` of a `GroupFields` or `SortFields`, which the print groups and sorts by. */
function groupAndSortFields(xml: string): string[] {
  return [...xml.matchAll(/<(GroupFields|SortFields)>([\s\S]*?)<\/\1>/g)].flatMap((b) => [...b[2].matchAll(/\sFieldName="([^"]*)"/g)].map((m) => decodeXmlText(m[1]).trim()));
}

/**
 * A case's records for one report: each field the report binds, groups or
 * sorts on, other than its own calculated fields and parameters, given the
 * case column it matches (`matchColumns`, as the Data tab matches a column to
 * a field), so a run that calls the quantity `Quantity` and one that calls it
 * `Qty` both print the page's numbers. A field nothing matches is left out of
 * the records, which is how the data would treat a field it lacks.
 */
export function rowsForReport(xml: string, data: CaseData): { rows: RecordValues[]; types: Record<string, string>; mapping: Record<string, string | null> } {
  const columns = [...new Set(data.rows.flatMap((r) => Object.keys(r)))];
  const hints = Object.fromEntries(columns.map((c) => [c, TYPE_HINT[data.types?.[c] ?? ''] ?? '']));
  const calculated = new Set([...(/<CalculatedFields>([\s\S]*?)<\/CalculatedFields>/.exec(xml)?.[1] ?? '').matchAll(/\sName="([^"]*)"/g)].map((m) => m[1]));
  const wanted = [...new Set([...readBoundFields(xml), ...groupAndSortFields(xml)])].filter((f) => f && !calculated.has(f) && !/^(Parameters|DataSource|ReportItems)\./.test(f));
  const evidence: FieldEvidence[] = columns.map((name) => ({ name, type: FIELD_TYPE[hints[name]] ?? 'string', samples: data.rows.slice(0, 5).map((r) => r[name] ?? '') }));
  const matches = matchColumns(wanted.map((heading) => ({ heading })), evidence);
  const mapping = Object.fromEntries(wanted.map((w, i) => [w, columns.includes(w) ? w : matches[i]?.field ?? null]));
  const rows = data.rows.map((r) => {
    const out: RecordValues = { ...r };
    for (const [field, column] of Object.entries(mapping)) if (column && r[column] !== undefined) out[field] = r[column];
    return out;
  });
  const types: Record<string, string> = {};
  for (const [c, hint] of Object.entries(hints)) if (hint) types[c] = hint;
  for (const [field, column] of Object.entries(mapping)) if (column && hints[column]) types[field] = hints[column];
  return { rows, types, mapping };
}

/** What a report prints with a case's records, read off Forma's own `paginate`. */
export interface PrintMeasurements {
  records: number;
  pages: number;
  /** Controls that run past the printable width, each counted once. */
  clipped: string[];
  /** Every text printed, in print order: each control's and each table cell's. */
  printed: string[];
  /** How many times the outermost group header prints: one per group, unless it repeats on each page. */
  groups: number;
  /** The case's column each field was printed from, or null where none matched. */
  mapping: Record<string, string | null>;
}

/** Print a report with a case's records and read back what came out (CC-02). */
export function printReport(xml: string, data: CaseData): PrintMeasurements {
  const { rows, types, mapping } = rowsForReport(xml, data);
  const structure = parseReportStructure(xml);
  const report = paginate(structure, rows.length, { rows, rowTypes: types, maxPages: 60 });
  const headers = structure.bands.filter((b) => b.kind === 'GroupHeader');
  // The outer group: the higher Level, and between equals the later in the file (s19).
  const outer = headers.reduce<(typeof headers)[number] | null>((best, b) => (!best || b.level >= best.level ? b : best), null);
  const right = report.content.left + report.content.width + 0.5;
  const clipped = new Set<string>();
  const printed: string[] = [];
  let groups = 0;
  for (const page of report.pages) {
    for (const band of page.bands) {
      if (outer && band.band === outer) groups++;
      for (const pc of band.controls) {
        if (!pc.control.visible) continue;
        // On its own page, not on a page added for what runs past the margin, whose band is shifted left (row 64).
        if (band.left >= report.content.left && band.left + pc.control.x + pc.control.width > right) clipped.add(`${band.band.name}/${pc.control.name}`);
        if (pc.text?.trim()) printed.push(pc.text);
        for (const row of pc.cellTexts ?? []) for (const cell of row) if (cell?.trim()) printed.push(cell);
      }
    }
  }
  return { records: rows.length, pages: report.pages.length, clipped: [...clipped], printed, groups, mapping };
}

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
  /**
   * Bounds on the median font size, in points, across every `Font` written;
   * or `relative`, within `within` (default 0.1) of the source's own median,
   * `sourcePt` (2026-11-11, CC-02: the invoice's body is 14px at 150dpi,
   * 6.72pt, and a fixed 8 to 12 failed the faithful size and passed +34%).
   * `run.ts --measure-source` reads it off an HTML source.
   */
  fontSize?: { median?: { min?: number; max?: number }; relative?: { sourcePt: number; within?: number } };
  /**
   * `declared`: whether the root `Margins` must be something other than all
   * zeros. `loaded`: declared, and four whole numbers, which is what
   * DevExpress 20.1 keeps (CC-03); anything else it drops.
   */
  margins?: { declared?: boolean; loaded?: boolean };
  /**
   * What the report prints with the case's `data.json` (CC-02): at most or at
   * least so many pages, at most `clippedMax` controls past the printable
   * width, each of `printed` found in the printed text (case and spacing
   * aside), and between `groups.min` and `groups.max` groups. Without a
   * `data.json` every one of them fails, so a case cannot claim them unread.
   */
  print?: { pages?: { min?: number; max?: number }; clippedMax?: number; printed?: string[]; groups?: { min?: number; max?: number } };
  /** Audit outcome on the finished file. */
  audit?: { errors?: number; maxWarnings?: number };
  /** Whether `layout.sections.length` must equal the number of content bands. */
  sectionsMatchBands?: boolean;
  /** The exact root `SerializerVersion`, e.g. `20.1.3.0`. */
  serializerVersion?: string;
  /**
   * Fields of a shared database the report must print (2026-11-09, the SQL
   * Server programme, item 23): each bound by name, matched case-insensitively.
   * `minRatio` is the fraction of `fields` that must be bound, default 1.
   * `notFromText` (2026-11-11, CC-09): no bound field is named after the
   * report's title or is one of a caption's numbered copies
   * (`fieldsNamedAfterText`), which no data could fill.
   */
  bindings?: { fields?: string[]; minRatio?: number; notFromText?: boolean };
  /** The query the written SQL data source must read, by its name (`Customers`). */
  dataSource?: { query: string };
}

export interface FidelityMeasurements {
  /** `checkRepxComplete` on the file: did the model finish writing it. */
  complete: boolean;
  serializerVersion: string | null;
  unit: string;
  page: { width: number; height: number };
  /** The root `Margins`, in report units, or null when the attribute is absent. */
  margins: { left: number; right: number; top: number; bottom: number } | null;
  /** Whether `Margins` is written as the four whole numbers DevExpress keeps (CC-03). */
  marginsWhole: boolean;
  /** Bound fields named after the report's own words (`fieldsNamedAfterText`, CC-09). */
  namedAfterText: string[];
  /** What it prints with the case's records, or null when the case has none (CC-02). */
  print: PrintMeasurements | null;
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
  /** Every field the report binds, as `readBoundFields` reads them (2026-11-09). */
  boundFields: string[];
  /** The queries of its SQL data sources, by name. */
  dataSourceQueries: string[];
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
export function measureReport(repxContent: string | null | undefined, layout?: ReportLayout | null, data?: CaseData | null): FidelityMeasurements {
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

  let print: PrintMeasurements | null = null;
  if (data && xml.trim()) {
    try {
      print = printReport(xml, data);
    } catch (error) {
      structure.problems.push(`The print with the case's records failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /*
   * With the case's columns as the data's fields, so a group on a field the
   * data lacks is named (CC-04), and with every field the print matched to a
   * column as well: a run that groups on `SalesRegion` prints a group per
   * region through `matchColumns`, so the audit calling the same field unknown
   * would score one answer two ways (2026-11-11, the review of CC-02).
   */
  const columns = data ? data.rows.flatMap((r) => Object.keys(r)) : [];
  const matched = Object.entries(print?.mapping ?? {}).filter(([, column]) => column !== null).map(([field]) => field);
  const dataFields = [...new Set([...columns, ...matched])];
  const audit = auditRepx(xml, layout ?? null, dataFields.length ? { fields: dataFields } : {});

  return {
    complete: checkRepxComplete(xml).complete,
    serializerVersion: root.SerializerVersion ?? null,
    unit: structure.unit,
    page: structure.page,
    margins: parseMargins(root.Margins),
    marginsWhole: root.Margins !== undefined && wholeMarginsWritten(root.Margins),
    namedAfterText: fieldsNamedAfterText(xml),
    print,
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
    boundFields: readBoundFields(xml),
    dataSourceQueries: readRepxDataSources(xml).flatMap((d) => d.queries.map((q) => q.name)),
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
    // What prints counts as well as what is written (CC-02): `'Subtotal ' + [Region]` prints "Subtotal North".
    const haystack = normalizeText([...m.texts, ...(m.print?.printed ?? [])].join(' \n '));
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
  if (expect.fontSize?.relative) {
    const { sourcePt, within = 0.1 } = expect.fontSize.relative;
    const off = m.fontMedianPt === null ? null : (m.fontMedianPt - sourcePt) / sourcePt;
    checks.push({
      id: 'fontSize.relative',
      pass: off !== null && Math.abs(off) <= within + 1e-9,
      expected: `within ${Math.round(within * 100)}% of the source's ${sourcePt}pt`,
      actual: off === null ? 'no Font written' : `${m.fontMedianPt}pt, ${off >= 0 ? '+' : ''}${Math.round(off * 100)}%`,
    });
  }

  if (expect.margins?.loaded !== undefined) {
    const declared = !!m.margins && (m.margins.left || m.margins.right || m.margins.top || m.margins.bottom) !== 0;
    const loaded = declared && m.marginsWhole;
    checks.push({
      id: 'margins.loaded',
      pass: loaded === expect.margins.loaded,
      expected: expect.margins.loaded ? 'non-zero Margins in whole numbers' : 'Margins DevExpress drops',
      actual: m.margins ? `${m.margins.left}, ${m.margins.right}, ${m.margins.top}, ${m.margins.bottom}${m.marginsWhole ? '' : ' (not whole: dropped on load)'}` : 'no Margins attribute',
    });
  }

  if (expect.print) {
    const p = m.print;
    const none = 'not printed: the case has no data.json';
    if (expect.print.pages) {
      checks.push({ id: 'print.pages', pass: !!p && inRange(p.pages, expect.print.pages), expected: describeRange(expect.print.pages), actual: p ? `${p.pages} over ${p.records} records` : none });
    }
    if (expect.print.clippedMax !== undefined) {
      checks.push({
        id: 'print.clipped',
        pass: !!p && p.clipped.length <= expect.print.clippedMax,
        expected: `<= ${expect.print.clippedMax}`,
        actual: p ? (p.clipped.length ? `${p.clipped.length} (${p.clipped.slice(0, 4).join(', ')}${p.clipped.length > 4 ? ', ...' : ''})` : '0') : none,
      });
    }
    if (expect.print.printed) {
      const haystack = p ? normalizeText(p.printed.join(' \n ')) : '';
      const missing = expect.print.printed.filter((s) => !haystack.includes(normalizeText(s)));
      checks.push({
        id: 'print.printed',
        pass: !!p && missing.length === 0,
        expected: `all of ${expect.print.printed.length} printed`,
        actual: p ? (missing.length ? `missing: ${missing.map((s) => JSON.stringify(s)).join(', ')}` : `${expect.print.printed.length}/${expect.print.printed.length}`) : none,
      });
    }
    if (expect.print.groups) {
      checks.push({ id: 'print.groups', pass: !!p && inRange(p.groups, expect.print.groups), expected: describeRange(expect.print.groups), actual: p ? `${p.groups}` : none });
    }
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

  // The database's two (2026-11-09): which of its fields the report binds, and what the source reads.
  if (expect.bindings?.fields) {
    const fields = expect.bindings.fields;
    const bound = new Set(m.boundFields.map((f) => f.toLowerCase()));
    const found = fields.filter((f) => bound.has(f.toLowerCase()));
    const need = Math.ceil(fields.length * (expect.bindings.minRatio ?? 1));
    const missing = fields.filter((f) => !bound.has(f.toLowerCase()));
    checks.push({
      id: 'bindings',
      pass: found.length >= need,
      expected: `>= ${need} of ${fields.length} fields bound`,
      actual: `${found.length}${missing.length ? ` (missing ${missing.join(', ')})` : ''}`,
    });
  }
  if (expect.bindings?.notFromText) {
    checks.push({
      id: 'bindings.notFromText',
      pass: m.namedAfterText.length === 0,
      expected: 'no field named after the title or a repeated caption',
      actual: m.namedAfterText.length ? m.namedAfterText.slice(0, 6).map((f) => `[${f}]`).join(', ') : 'none',
    });
  }
  if (expect.dataSource) {
    checks.push({
      id: 'dataSource',
      pass: m.dataSourceQueries.some((q) => q.toLowerCase() === expect.dataSource!.query.toLowerCase()),
      expected: `reads ${expect.dataSource.query}`,
      actual: m.dataSourceQueries.length ? m.dataSourceQueries.join(', ') : 'no data source',
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

/**
 * A case's self-test (2026-11-11, CC-02): a `.repx` source scored as if it
 * were the answer must fail at least one check, or the case measures nothing.
 * The FastReport case scored its own untouched source 12/12 while DevExpress
 * refused to print it. The checks that failed, empty when it measures nothing.
 */
export function selfTest(sourceXml: string, expect: FidelityExpectations, data?: CaseData | null): FidelityCheck[] {
  return checkFidelity(measureReport(sourceXml, null, data), expect).filter((c) => !c.pass);
}
