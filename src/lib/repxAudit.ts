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

/**
 * The order DevExpress prints bands in, as `ControlType` strings.
 *
 * From its own "Print Order of Bands": ReportHeader, PageHeader, GroupHeader,
 * Detail, GroupFooter, ReportFooter, PageFooter, with the margin bands outside
 * them. The designer stacks them the same way.
 *
 * **This is a second copy.** `BAND_ORDER` in `reportPreview.ts` is the same
 * sequence with the `Band` suffix stripped, because that module works in its own
 * `BandKind` union while this one works on raw markup. They must agree.
 *
 * Deliberately not imported from `reportBands.ts`, which owns the band skeleton
 * and would be the natural home: that module carries the structure prompt, and
 * `App.tsx` imports this file eagerly, so the import would pull ~19 kB of prompt
 * text onto the critical path. That is the regression the `index-` budget in
 * `scripts/check-bundle-size.mjs` exists to catch, and it is cheaper not to
 * cause it than to notice it later.
 */
const PRINT_ORDER = [
  'TopMarginBand',
  'ReportHeaderBand',
  'PageHeaderBand',
  'GroupHeaderBand',
  'DetailBand',
  'GroupFooterBand',
  'ReportFooterBand',
  'PageFooterBand',
  'BottomMarginBand',
];

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
   * Bands listed in an order that is not the print order.
   *
   * DevExpress places a band by its TYPE, so the report still opens and still
   * renders correctly -- which is why this is a warning and not an error, and
   * why it went unchecked. The consequence is elsewhere, and it is silent.
   *
   * `repxMargins.ts` reads the band collection in FILE order: it takes the first
   * body band, measures the design's top inset from that band's controls, and
   * shifts that band's controls by it. On a file whose first body band is not
   * the one that prints first, the lift either declines outright ("the first
   * body band carries no controls") or measures from the wrong band -- and the
   * design's margin stays drawn as whitespace instead of becoming real page
   * margins. Neither says anything at export time.
   *
   * `reportPreview.ts` sorts by band type before drawing, and its comment there
   * has claimed since it was written that "repxAudit reports that". Until
   * 2026-09-06 it did not. This is that check, so the sentence is now true.
   *
   * Skipped entirely when a DetailReportBand is present: that band nests a whole
   * second set of bands inside itself, so a flat scan reads the inner
   * ReportHeader as coming after the outer Detail and would report every
   * master-detail report as misordered. A false positive on a legitimate shape
   * is worse than no check, per this file's own header.
   */
  if (!has(text, 'DetailReportBand')) {
    const sequence = [...text.matchAll(/ControlType="(\w*Band)"/g)].map((m) => m[1]);
    const ranked = sequence
      .map((name) => ({ name, rank: PRINT_ORDER.indexOf(name) }))
      .filter((b) => b.rank >= 0);
    const firstDrop = ranked.findIndex((b, i) => i > 0 && b.rank < ranked[i - 1].rank);
    if (firstDrop > 0) {
      add(
        'warning',
        'band-order',
        `Bands are listed out of print order — "${ranked[firstDrop].name}" comes after ` +
          `"${ranked[firstDrop - 1].name}". DevExpress places a band by its type, so the report still ` +
          'renders, but the margin pass reads this collection in file order: it measures the design\'s ' +
          'top inset from the first body band and shifts that band. Out of order, it lifts from the ' +
          'wrong band or declines, and the margin stays drawn as whitespace.',
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

  /*
   * A panel holding nothing, and a subreport naming nothing. Same class as the
   * two above: both load, both print an empty space, neither says a word.
   *
   * The panel case is the likelier of the two. A panel exists to group
   * controls, so an empty one is either a rectangle drawn the hard way — the
   * prompt says not to — or a group whose children were written as siblings of
   * the panel instead of inside it, which is the mistake the panel-relative
   * coordinate rule exists to prevent and which leaves the controls sitting
   * outside the box that was meant to contain them.
   */
  /*
   * Bookmarks, and the two ways a document map comes out wrong.
   *
   * `BookmarkParent` is a `#Ref-N` pointer at another CONTROL (measured,
   * `RepxProbe emit-book`). Two failures, neither of which stops the file
   * loading:
   *
   *   - the pointer naming a Ref that carries no `Bookmark`. The child has
   *     nothing to nest under, so it lands at the top level beside the entry it
   *     was meant to sit inside — a flat map where a tree was intended;
   *   - a literal `Bookmark=` on a control inside the Detail band, which repeats
   *     once per record. Forty rows produce forty identical entries, and the
   *     map becomes useless in exactly the reports long enough to need one.
   *
   * The second is a warning rather than an error because a Detail band that
   * genuinely prints once — a single-record letter — is a legitimate place for
   * a literal.
   */
  const bookmarked = new Map<string, string>();
  for (const control of text.matchAll(/<Item\d+\b[^>]*ControlType="XR[^"]*"[^>]*>/g)) {
    const ref = /\sRef="(\d+)"/.exec(control[0])?.[1];
    const mark = /\sBookmark="([^"]*)"/.exec(control[0])?.[1];
    if (ref && mark !== undefined) bookmarked.set(ref, mark);
  }

  /*
   * A table of contents with nothing to list.
   *
   * It is populated from the report's bookmarks at print time, so a TOC in a
   * report that declares none prints its heading and an empty page — which is
   * the worst possible version of this control, because the heading makes it
   * look like the content is coming.
   *
   * DevExpress itself refuses the two placement mistakes by throwing (only in a
   * ReportHeader or ReportFooter; only one per report), so those need no check
   * here — a file that gets them wrong never loads. This one it accepts.
   */
  if (/ControlType="XRTableOfContents"/.test(text) && bookmarked.size === 0) {
    add(
      'warning',
      'toc-without-bookmarks',
      'The report has a table of contents and no bookmarks, so it prints a "Contents" heading with ' +
        'nothing under it. A table of contents lists bookmarks; without them it is an empty page.',
    );
  }

  const parents = [...text.matchAll(/BookmarkParent="#Ref-(\d+)"/g)].map((m) => m[1]);
  const orphans = [...new Set(parents.filter((ref) => !bookmarked.has(ref)))];
  if (orphans.length) {
    add(
      'warning',
      'bookmark-parent-unbookmarked',
      `${orphans.length} bookmark(s) name a parent (Ref ${orphans.join(', ')}) that carries no Bookmark of its own. ` +
        'They cannot nest under it, so they appear at the top of the document map instead of inside the section they belong to.',
    );
  }

  for (const detail of text.matchAll(/<Item\d+\b[^>]*ControlType="DetailBand"[^>]*>([\s\S]*?)(?=<Item\d+\b[^>]*ControlType="\w+Band"|<\/Bands>)/g)) {
    const literals = [...detail[1].matchAll(/\sBookmark="([^"]+)"/g)].length;
    if (literals) {
      add(
        'warning',
        'bookmark-literal-in-detail',
        `${literals} literal Bookmark(s) sit on controls in the Detail band, which prints once per record. ` +
          'Every row produces the same entry, so the document map repeats one caption instead of listing the data. ' +
          'A per-record bookmark is an ExpressionBindings item with PropertyName="Bookmark".',
      );
      break;
    }
  }

  /*
   * Sorting, and the one mistake that is invisible in the file.
   *
   * `<SortFields>` belongs to the DetailBand. On any other band DevExpress reads
   * it, keeps it, and never applies it — measured indirectly: the collection is
   * a band property and only the detail band iterates rows. So a sort written on
   * a PageHeader is a sort that silently does not happen.
   *
   * `<SortFields>` and `<GroupFields>` have identical item shapes — `FieldName`
   * plus an optional `SortOrder`, no `ControlType` (`RepxProbe emit-sort`) — so
   * the parent element name is the only thing distinguishing them, both here and
   * in any parser that reads them.
   */
  for (const band of text.matchAll(/<Item\d+\b[^>]*ControlType="(\w+Band)"[^>]*>([\s\S]*?)(?=<Item\d+\b[^>]*ControlType="\w+Band"|<\/Bands>)/g)) {
    const [, kind, body] = band;
    if (!/<SortFields>/.test(body)) continue;
    if (kind === 'DetailBand' || kind === 'DetailReportBand') continue;
    add(
      'warning',
      'sort-on-wrong-band',
      `A <SortFields> collection sits on a ${kind}. Sorting is a property of the Detail band — ` +
        'DevExpress keeps this and never applies it, so the rows print unsorted with nothing to say why.',
    );
  }

  /*
   * A page number that is not in a page band.
   *
   * `XRPageInfo` is placed by what it MEANS, not by where the number sits on
   * the sheet, and the two disagree constantly: on a one-page invoice the page
   * number is drawn below the totals, so a model working from the picture puts
   * it in the ReportFooter and the file looks right.
   *
   * It is not. ReportFooter prints once, after the last record -- so the report
   * has no page number on any page except the last, and on a one-page report
   * that is invisible. It surfaces the first time somebody prints something
   * long, which is exactly when page numbers matter. Observed on a real
   * generation 2026-09-06: XRPageInfo at ReportFooter y=190 with the PageFooter
   * band emitted empty at HeightF=0.
   *
   * Only the PAGE-NUMBER kinds are checked. `PageInfo="DateTime"` and
   * `"UserName"` are legitimately printed once on a cover or in a header, so
   * warning about those would fire on correct reports -- and a check that cries
   * wolf on a good file is worse than no check, per this file's own header.
   */
  const PAGE_NUMBER_KINDS = ['Number', 'NumberOfTotal', 'Total', 'RomLowNumber', 'RomHiNumber'];
  for (const band of text.matchAll(
    /<Item\d+\b[^>]*ControlType="(\w+Band)"[^>]*>([\s\S]*?)(?=<Item\d+\b[^>]*ControlType="\w+Band"|<\/Bands>)/g,
  )) {
    const [, kind, body] = band;
    if (kind === 'PageFooterBand' || kind === 'PageHeaderBand') continue;
    for (const attrs of elementsOfType(body, 'XRPageInfo')) {
      const value = attr(attrs, 'PageInfo');
      if (!value || !PAGE_NUMBER_KINDS.includes(value)) continue;
      add(
        'warning',
        'pageinfo-wrong-band',
        `A page number (XRPageInfo PageInfo="${value}") sits in the ${kind}. ` +
          'That band does not print on every sheet, so the number appears once instead of once per page ' +
          '-- on a ReportFooter, only after the last record. Page numbers belong in the PageFooter.',
      );
      break;
    }
  }

  const sortBlocks = [...text.matchAll(/<SortFields>([\s\S]*?)<\/SortFields>/g)];
  for (const block of sortBlocks) {
    const fields = [...block[1].matchAll(/FieldName="([^"]*)"/g)].map((m) => m[1]);
    const blank = fields.filter((f) => !f.trim()).length;
    if (blank) {
      add('warning', 'sort-field-empty', `${blank} sort field(s) name no field, so they sort by nothing.`);
    }
    const repeated = [...new Set(fields.filter((f, i) => f && fields.indexOf(f) !== i))];
    if (repeated.length) {
      add(
        'warning',
        'sort-field-duplicate',
        `${repeated.map((f) => `"${f}"`).join(', ')} appears twice in one <SortFields>. ` +
          'The second occurrence cannot change the order and is usually a field meant for a different position.',
      );
    }
  }

  /*
   * Calculated fields. A control references one exactly as it references a real
   * data field — `Expression="[LineTotal]"` says nothing about where the field
   * comes from (measured, `RepxProbe emit-calc`). That symmetry is convenient
   * for the model and unhelpful here: it means nothing in a binding can tell us
   * whether a name resolves, so the checks have to be about the declarations.
   *
   * Two failures, both of which load without complaint:
   *
   *   - an empty Expression, which computes nothing and prints blank in every
   *     row bound to it;
   *   - two fields sharing a Name, where the later silently wins and every
   *     binding to that name gets the wrong arithmetic.
   *
   * A field nothing references is only a warning: harmless in itself, but it
   * usually means the binding that was meant to use it went to a literal.
   */
  const calcBlock = /<CalculatedFields>([\s\S]*?)<\/CalculatedFields>/.exec(text);
  if (calcBlock) {
    const fields = [...calcBlock[1].matchAll(/<Item\d+\b[^>]*>/g)].map((m) => m[0]);
    const nameOf = (tag: string) => /\sName="([^"]*)"/.exec(tag)?.[1] ?? '';
    const exprOf = (tag: string) => /\sExpression="([^"]*)"/.exec(tag)?.[1] ?? '';

    const blank = fields.filter((f) => !exprOf(f).trim()).map(nameOf).filter(Boolean);
    if (blank.length) {
      add(
        'error',
        'calculated-field-empty',
        `${blank.map((n) => `"${n}"`).join(', ')} ${blank.length === 1 ? 'is a calculated field' : 'are calculated fields'} ` +
          'with no expression, so every cell bound to it prints blank. DevExpress loads it without complaint.',
      );
    }

    const names = fields.map(nameOf).filter(Boolean);
    const repeated = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (repeated.length) {
      add(
        'error',
        'calculated-field-duplicate',
        `${repeated.map((n) => `"${n}"`).join(', ')} ${repeated.length === 1 ? 'is declared' : 'are declared'} ` +
          'more than once. The later declaration wins, so bindings to that name compute the wrong expression.',
      );
    }

    const unused = names.filter((n) => n && !new RegExp(`\\[${n}\\]`).test(text));
    if (unused.length) {
      add(
        'warning',
        'calculated-field-unused',
        `${unused.map((n) => `"${n}"`).join(', ')} ${unused.length === 1 ? 'is' : 'are'} declared and never used. ` +
          'Usually the cell that should carry the calculation still holds a literal number.',
      );
    }
  }

  /*
   * Conditional formatting, and its two silent failures.
   *
   * A `<FormattingRuleLinks>` item points at a rule by `Value="#Ref-N"`
   * (measured, `RepxProbe emit-rules`). Two things go wrong without a word:
   *
   *   - a link naming a Ref that is not a rule in the sheet. The rule never
   *     fires, so the overdue rows print black and the report looks like the
   *     condition was never met;
   *   - a rule nothing links, which is the same defect seen from the other end
   *     and usually means the link was written on the wrong element.
   *
   * Both are errors of *behaviour* rather than of content, which is why they
   * cannot be caught by counting controls the way the checks above do.
   */
  const ruleRefs = new Set(
    [...text.matchAll(/<FormattingRuleSheet>([\s\S]*?)<\/FormattingRuleSheet>/g)]
      .flatMap((sheet) => [...sheet[1].matchAll(/<Item\d+\s+Ref="(\d+)"/g)])
      .map((item) => item[1]),
  );
  const linked = [...text.matchAll(/<FormattingRuleLinks>([\s\S]*?)<\/FormattingRuleLinks>/g)]
    .flatMap((block) => [...block[1].matchAll(/Value="#Ref-(\d+)"/g)])
    .map((link) => link[1]);

  if (ruleRefs.size || linked.length) {
    const dangling = [...new Set(linked.filter((ref) => !ruleRefs.has(ref)))];
    if (dangling.length) {
      add(
        'error',
        'formatting-rule-link-dangling',
        `${dangling.length} formatting-rule link(s) point at Ref ${dangling.join(', ')}, which is not a ` +
          'rule in the <FormattingRuleSheet>. The rule never fires, so the report prints as though the ' +
          'condition was never met — no error, just the wrong colours.',
      );
    }

    const usedRefs = new Set(linked);
    const unused = [...ruleRefs].filter((ref) => !usedRefs.has(ref));
    if (unused.length) {
      add(
        'warning',
        'formatting-rule-unused',
        `${unused.length} formatting rule(s) are declared and linked to nothing. Usually the link was ` +
          'written on the wrong element, so the formatting the report was meant to have is simply absent.',
      );
    }
  }

  const panels = (text.match(/ControlType="XRPanel"/g) ?? []).length;
  if (panels) {
    const withChildren = (text.match(/ControlType="XRPanel"[^>]*>\s*<Controls>/g) ?? []).length;
    if (withChildren < panels) {
      add(
        'warning',
        'empty-panel',
        `${panels - withChildren} of ${panels} panel(s) contain no controls. A panel exists to group ` +
          'controls, so an empty one is either a rectangle drawn the hard way or a group whose ' +
          'children were written beside the panel instead of inside it.',
      );
    }
  }

  const subreports = (text.match(/ControlType="XRSubreport"/g) ?? []).length;
  if (subreports) {
    const sourced = (text.match(/ControlType="XRSubreport"[^>]*ReportSourceUrl="/g) ?? []).length
      + (text.match(/ControlType="XRSubreport"[^>]*>\s*<ReportSource\b/g) ?? []).length;
    if (sourced < subreports) {
      add(
        'warning',
        'subreport-without-source',
        `${subreports - sourced} of ${subreports} subreport(s) name no report to embed — neither a ` +
          'ReportSourceUrl nor a nested <ReportSource>. The control prints nothing at all.',
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
