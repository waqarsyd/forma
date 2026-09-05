/**
 * Everything this project learned the hard way, asked of a report before the
 * user finds out.
 *
 * ## Why this exists
 *
 * Every defect found on 2026-09-04 reached the user first. The tables were
 * silently discarded on load, the page numbering was dropped, the report had no
 * Detail band and so could not be bound — and in each case the app said the
 * generation had succeeded, because by its own lights it had. The XML parsed,
 * the mockup drew, the spec read well.
 *
 * The checks that would have caught them existed within an hour of each being
 * found, but as separate repair passes and as a C# tool run by hand. This is
 * the same knowledge asked as a question rather than applied as a fix: what is
 * still wrong with this report *after* everything repairable has been repaired?
 *
 * ## Errors versus warnings
 *
 * An **error** means the file is broken: it will not open, or DevExpress will
 * load it and quietly throw content away. Those are the failures worth blocking
 * an export over, and after the repair passes they should be impossible —
 * finding one means a repair declined, which is a thing to know about.
 *
 * A **warning** means the file opens and is a worse report than it should be:
 * it prints once because there is no Detail band, or a page number is missing
 * because an enum was invented. Nothing here should block anything; the user
 * asked for a report and got one, and is entitled to decide the rest.
 *
 * ## What it deliberately does not do
 *
 * It does not judge fidelity. Whether the font is the right size, whether the
 * columns line up with the source, whether the model read the document
 * correctly — none of that is checkable from the XML alone, and pretending
 * otherwise would make a green result mean less than it does. Every check here
 * is a structural fact with a known consequence, measured against DevExpress
 * itself via `tools/RepxProbe`.
 */
import { checkRepxComplete } from './repxTruncation';
import { normalizeItemNames } from './repxItems';
import { auditRefs } from './repxRefs';
import { parseParameters, parameterReferences } from './repxParameters';
import type { ReportLayout } from './reportTypes';

export type RepxSeverity = 'error' | 'warning';

export interface RepxFinding {
  severity: RepxSeverity;
  /** Stable identifier, so a caller can filter without matching prose. */
  code: string;
  /** What is wrong and what it costs, in a form worth showing a user. */
  message: string;
}

export interface RepxAudit {
  findings: RepxFinding[];
  errors: number;
  warnings: number;
  /** True when nothing at all was found. */
  ok: boolean;
  /** One line worth logging. */
  summary: string;
}

/** The eight members of DevExpress's PageInfo enum. Anything else is dropped on load. */
const PAGE_INFO_VALUES = [
  'None', 'Number', 'NumberOfTotal', 'Total',
  'RomLowNumber', 'RomHiNumber', 'DateTime', 'UserName',
];

/** An opening element with its attributes, for the light structural checks. */
const ELEMENT = /<[A-Za-z_][\w.:-]*((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*\/?>/g;

const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

/** Every element of one control type, as raw attribute strings. */
function elementsOfType(xml: string, type: string): string[] {
  const out: string[] = [];
  ELEMENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ELEMENT.exec(xml)) !== null) {
    if (attr(m[1], 'ControlType') === type) out.push(m[1]);
  }
  return out;
}

const has = (xml: string, type: string) => new RegExp(`ControlType="${type}"`).test(xml);

/** The largest grid the model drew in the mockup, if it drew one. */
function biggestGrid(layout: ReportLayout | null | undefined): { rows: number; section: string } | null {
  let best: { rows: number; section: string } | null = null;
  for (const section of layout?.sections ?? []) {
    for (const element of section.elements ?? []) {
      const rows = element.type === 'table' ? element.rows?.length ?? 0 : 0;
      if (rows > (best?.rows ?? 0)) best = { rows, section: section.name || section.type };
    }
  }
  return best;
}

/**
 * Audit a finished report.
 *
 * Runs after the repair passes, so the errors it can still report are the ones
 * a repair declined to make rather than ones nobody looked for.
 *
 * ## Why the layout is worth passing in
 *
 * The two artifacts come out of the same response and describe the same
 * document, so where they disagree, one of them is wrong — and that is
 * checkable in a way neither is on its own. gemini.md has recorded since
 * 2026-08-29 that they can disagree about the band count and that nothing
 * enforces the correspondence; this is the enforcement.
 *
 * It also turns the vaguest finding here into the most specific. "There is no
 * Detail band" is true of a certificate, where it is correct. "The mockup shows
 * a 12-row grid and there is no Detail band" is a defect, and the difference
 * between them is exactly the evidence the layout carries. Observed on three
 * live runs from one image on 2026-09-04, two of which produced no Detail band.
 *
 * The layout is optional: a report loaded from an old save may not have one, and
 * the structural checks are worth running either way.
 */
export function auditRepx(xml: string | undefined | null, layout?: ReportLayout | null): RepxAudit {
  const text = xml ?? '';
  const findings: RepxFinding[] = [];
  const add = (severity: RepxSeverity, code: string, message: string) =>
    findings.push({ severity, code, message });

  if (!text.trim()) {
    add('error', 'empty', 'No REPX was produced at all.');
    return { findings, errors: 1, warnings: 0, ok: false, summary: 'no REPX was produced' };
  }

  // --- errors: the file is broken or will lose content on load ---------------

  const complete = checkRepxComplete(text);
  if (!complete.complete) {
    add('error', 'truncated', `The XML is unfinished — ${complete.reason}. A designer will refuse it.`);
  }

  const items = normalizeItemNames(text);
  if (items.applied) {
    add(
      'error',
      'item-numbering',
      `${items.renamed} element(s) are named for the wrong position in their collection. ` +
        `DevExpress finds collection members by that name, so those collections load EMPTY and their content is lost without an error.`
    );
  }

  const refs = auditRefs(text);
  if (refs.duplicates.length) {
    const which = refs.duplicates.map((d) => `${d.ref}x${d.count}`).join(', ');
    add(
      'error',
      'duplicate-ref',
      `Ref values are reused (${which}). DevExpress treats two elements sharing a Ref as ONE object and discards the second's content silently.`
    );
  }

  // --- warnings: it opens, but it is a worse report than it should be --------

  const grid = biggestGrid(layout);

  if (!has(text, 'DetailBand')) {
    // The layout is what turns this from an observation into a diagnosis: a
    // certificate legitimately has no Detail band, a document whose mockup
    // shows a multi-row grid does not.
    const evidence = grid && grid.rows >= 2
      ? ` The mockup drew a ${grid.rows}-row grid in "${grid.section}", so this document does have repeating rows — they belong in a Detail band as ONE row, not in the header.`
      : '';
    add(
      'warning',
      'no-detail-band',
      'There is no Detail band, so this report prints its content exactly once and cannot be bound to a data source. ' +
        'It is a picture of the document rather than something that can produce it for every record.' + evidence
    );
  }

  // The grid exists in the mockup and nowhere in the report: it was drawn as
  // free-standing controls instead of a table. Documented in gemini.md as the
  // failure that tracked whether the user's prompt happened to say "table";
  // the cost is columns that cannot be bound, resized or repeated.
  if (grid && grid.rows >= 2 && !has(text, 'XRTable')) {
    add(
      'warning',
      'grid-not-a-table',
      `The mockup drew a ${grid.rows}-row grid in "${grid.section}" but the report contains no XRTable at all, ` +
        'so that region was emitted as separate controls. Those columns cannot be bound to data, resized as a table, or repeated per record.'
    );
  }

  // The prompt asks for one section per content band, named after it. Nothing
  // enforced that until now, and the band count shown in the UI comes from the
  // layout while the file the user exports is the REPX.
  if (layout?.sections?.length) {
    const contentBands = (text.match(/ControlType="(?!TopMarginBand|BottomMarginBand)\w*Band"/g) ?? []).length;
    if (contentBands && contentBands !== layout.sections.length) {
      add(
        'warning',
        'band-section-mismatch',
        `The mockup has ${layout.sections.length} section(s) and the report has ${contentBands} content band(s). ` +
          'They are meant to describe the same structure, so the preview is not showing what the exported file contains.'
      );
    }
  }

  /*
   * A GroupHeaderBand with no <GroupFields> groups by nothing.
   *
   * DevExpress accepts it and prints the band exactly once, so the report looks
   * like a report with a heading and is really a report whose grouping does not
   * exist -- the same class of silent wrongness as a Detail band that never
   * repeats. The two are easy to confuse in the file because the band is
   * present and correctly named; only the absent collection distinguishes them.
   *
   * Counted rather than tested with `has`, because nested grouping is several
   * bands and one of them missing its fields is the interesting case. The
   * `[^]*?` is lazy so two consecutive group headers do not read as one.
   */
  const groupHeaders = (text.match(/ControlType="GroupHeaderBand"/g) ?? []).length;
  if (groupHeaders) {
    const withFields = (
      text.match(/ControlType="GroupHeaderBand"[^>]*>[^]*?<GroupFields>/g) ?? []
    ).length;
    if (withFields < groupHeaders) {
      add(
        'warning',
        'group-without-fields',
        `${groupHeaders - withFields} of ${groupHeaders} group header band(s) carry no <GroupFields>, so they group by nothing. ` +
          'DevExpress prints such a band once instead of once per group, which looks like a heading and is a grouping that does not happen.',
      );
    }
  }

  // A group footer with no header has nothing to close. DevExpress does not
  // reject it; it simply never breaks, so the subtotal it carries becomes a
  // second grand total sitting above the real one.
  if (has(text, 'GroupFooterBand') && !groupHeaders) {
    add(
      'warning',
      'group-footer-without-header',
      'There is a GroupFooterBand but no GroupHeaderBand, so nothing defines where a group ends. ' +
        'Its contents print once at the end rather than once per group.',
    );
  }

  /*
   * Parameters the report uses but never declares.
   *
   * `?Name` in a filter and `[Parameters.Name]` in an expression both resolve
   * against the <Parameters> collection, and a name that is not there is a
   * filter that throws at run time or a label that prints nothing. Neither
   * shows up when the file is opened.
   *
   * A warning rather than an error because the reference scan is a text scan:
   * `Text="Ready?Now"` is indistinguishable from a filter reference, and
   * `repxParameters.ts` says so at the point it admits the limit. Blocking an
   * export on a false positive would be worse than naming a real one.
   */
  const declared = new Set(parseParameters(text).map((p) => p.name));
  const undeclared = parameterReferences(text).filter((name) => !declared.has(name));
  if (undeclared.length) {
    add(
      'warning',
      'undeclared-parameter',
      `The report refers to ${undeclared.map((n) => `"${n}"`).join(', ')} but declares no such parameter. ` +
        'A filter comparing an undeclared parameter fails when the report runs, and an expression using one prints nothing.',
    );
  }

  // The other direction: a parameter nobody uses still appears in the
  // parameters panel, so the reader is asked a question that changes nothing.
  const referenced = new Set(parameterReferences(text));
  const unused = [...declared].filter((name) => !referenced.has(name));
  if (unused.length) {
    add(
      'warning',
      'unused-parameter',
      `${unused.map((n) => `"${n}"`).join(', ')} ${unused.length === 1 ? 'is' : 'are'} declared but never used in a filter or an expression. ` +
        'DevExpress still prompts for it before the report runs, so the reader answers a question that changes nothing.',
    );
  }

  /*
   * A chart with no series, and a cross-tab missing one of its three field
   * collections. Both load without complaint and print an empty frame, which
   * on a page full of real content reads as "the data has not arrived yet"
   * rather than as a defect in the file.
   *
   * Counted per control, since a report can carry several charts and one of
   * them being empty is exactly the case worth naming.
   */
  const charts = (text.match(/ControlType="XRChart"/g) ?? []).length;
  if (charts) {
    const withSeries = (text.match(/ControlType="XRChart"[^>]*>[^]*?<SeriesSerializable>/g) ?? []).length;
    if (withSeries < charts) {
      add(
        'warning',
        'chart-without-series',
        `${charts - withSeries} of ${charts} chart(s) declare no series, so they plot nothing. ` +
          'DevExpress draws an empty frame, which looks like a chart still waiting for its data.',
      );
    }
  }

  const crossTabs = (text.match(/ControlType="XRCrossTab"/g) ?? []).length;
  if (crossTabs) {
    for (const collection of ['RowFields', 'ColumnFields', 'DataFields']) {
      const present = (text.match(new RegExp(`<${collection}>`, 'g')) ?? []).length;
      if (present < crossTabs) {
        add(
          'warning',
          'crosstab-missing-fields',
          `A cross-tab has no <${collection}>. All three field collections are required — ` +
            'without one the control prints nothing where the grid should be.',
        );
      }
    }
  }

  if (!has(text, 'TopMarginBand') || !has(text, 'BottomMarginBand')) {
    add(
      'warning',
      'no-margin-bands',
      'A margin band is missing. DevExpress treats both as mandatory, and the margin pass cannot lift the design\'s own margin without them.'
    );
  }

  for (const attrs of elementsOfType(text, 'XRPageInfo')) {
    const value = attr(attrs, 'PageInfo');
    if (value !== null && !PAGE_INFO_VALUES.includes(value)) {
      add(
        'warning',
        'bad-pageinfo',
        `XRPageInfo has PageInfo="${value}", which is not one of the eight valid values ` +
          `(${PAGE_INFO_VALUES.join(', ')}). DevExpress drops the attribute and the control prints nothing.`
      );
    }
    if (attr(attrs, 'Format') !== null) {
      add(
        'warning',
        'pageinfo-format-attr',
        'XRPageInfo uses Format=, which is not the property DevExpress reads. It is TextFormatString.'
      );
    }
  }

  for (const attrs of elementsOfType(text, 'XRTableCell')) {
    if (attr(attrs, 'LocationFloat') !== null || attr(attrs, 'SizeF') !== null) {
      add(
        'warning',
        'positioned-table-cell',
        'A table cell carries LocationFloat or SizeF. Cells are sized by Weight within their row; ' +
          'coordinates on a cell are ignored and usually mean the table was laid out as if it were free-standing controls.'
      );
      break; // One is enough; the cause is the same for every cell in the table.
    }
  }

  if (has(text, 'XRTable') && !has(text, 'XRTableCell')) {
    add('warning', 'empty-table', 'A table was emitted with no cells in it.');
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;

  return {
    findings,
    errors,
    warnings,
    ok: findings.length === 0,
    summary: findings.length
      ? `${errors} error(s), ${warnings} warning(s): ${findings.map((f) => f.code).join(', ')}`
      : 'no structural problems found',
  };
}
