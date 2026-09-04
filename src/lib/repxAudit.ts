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

/**
 * Audit a finished report.
 *
 * Runs after the repair passes, so the errors it can still report are the ones
 * a repair declined to make rather than ones nobody looked for.
 */
export function auditRepx(xml: string | undefined | null): RepxAudit {
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

  if (!has(text, 'DetailBand')) {
    add(
      'warning',
      'no-detail-band',
      'There is no Detail band, so this report prints its content exactly once and cannot be bound to a data source. ' +
        'It is a picture of the document rather than something that can produce it for every record.'
    );
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
