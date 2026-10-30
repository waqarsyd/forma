/**
 * Totals that print blank: an aggregate with no running scope.
 *
 * ## The measurement
 *
 * `sumSum([Amount])` in a cell's `Text` binding is an aggregate, and DevExpress
 * evaluates it only when the cell's `<Summary>` names what it runs over:
 * `Running="Group"`, `"Report"` or `"Page"`. Without that it prints NOTHING --
 * no error, no zero, an empty cell where the total should be. Measured by
 * printing, not by reading the serializer, with `RepxProbe render` against the
 * installed 20.1 on 2026-10-30 (cases c10 and c11 of
 * `docs/proposals/devexpress-parity.md`):
 *
 * - blank with no `<Summary>` at all, in a group header, the Detail band, a
 *   group footer, the report footer and the page footer alike;
 * - blank with `<Summary />` and with `<Summary Running="None" />`, so an
 *   element without a scope is the same as no element;
 * - correct with `Running="Group"` in a group footer and `Running="Report"` in
 *   the report footer, and with no `Ref` on the `<Summary>` either way;
 * - `"?"` with `Running="Group"` in the report footer, where there is no group.
 *
 * The first finding overturned two things this project believed. RepxProbe's
 * README said leaving `Running` off "totals the whole report at every group
 * break", read off the serializer and never printed; and the Data tab's
 * `bindFooterTotals` wrote every footer total with no `<Summary>`, so each one
 * it ever applied printed blank.
 *
 * ## What is repaired and what is only reported
 *
 * Two bands decide the scope on their own, and both were printed: a total in a
 * group footer runs over its group and a total in the report footer over the
 * report. Those are repaired. Everywhere else the right scope is a question of
 * intent -- a page footer may want the page's total or the report's, a running
 * sum in the Detail band may reset per group or not -- so those are left as
 * they are and `repxAudit` reports them, rather than guessed at and printed
 * confidently wrong.
 */

export type BandScope = 'Group' | 'Report';

export interface SummaryUse {
  /** The control's `Name`, or its element name when it has none. */
  control: string;
  /** The `ControlType` of the nearest enclosing band, e.g. `GroupFooterBand`. */
  band: string;
  /** The aggregate expression, decoded. */
  expression: string;
  /** `Running` as written, or `None` when absent or when there is no `<Summary>`. */
  running: string;
}

export interface SummaryProblem extends SummaryUse {
  /** `no-running`: prints blank. `group-in-report-footer`: prints "?". */
  kind: 'no-running' | 'group-in-report-footer';
}

export interface SummaryRepair {
  xml: string;
  applied: boolean;
  reason: string;
  /** What was set, one entry per control. */
  repaired: { control: string; band: string; running: BandScope }[];
}

/** The scope a band implies by itself. Only measured bands are listed. */
const SCOPE_BY_BAND: Record<string, BandScope> = {
  GroupFooterBand: 'Group',
  ReportFooterBand: 'Report',
};

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

const attrOf = (attrs: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? null;

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Whether an expression aggregates over records.
 *
 * DevExpress's summary functions are `sumSum`, `sumCount`, `sumRunningSum` and
 * the rest -- `sum` then a capital. The character before must not be a word
 * character, a dot or a bracket, so a field named `[sumTotal]` and a
 * collection aggregate such as `[Lines][].Sum([Amount])`, which needs no
 * `<Summary>`, are both left alone.
 */
export function isAggregate(expression: string): boolean {
  return /(?:^|[^\w.[])sum[A-Z]\w*\s*\(/.test(expression);
}

interface Open {
  name: string;
  attrs: string;
  /** Offset just past the opening tag's `>`. */
  openEnd: number;
  band: string | null;
  summary: { start: number; end: number; attrs: string } | null;
  aggregate: string | null;
}

interface Found extends SummaryUse {
  openEnd: number;
  summary: Open['summary'];
}

/** Every control whose `Text` is bound to an aggregate, with its band and scope. */
function scan(xml: string): Found[] {
  const found: Found[] = [];
  const stack: Open[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml)) !== null) {
    const [whole, closing, name, attrs, selfClosing] = m;
    if (closing) {
      const el = stack.pop();
      if (el?.aggregate) {
        found.push({
          control: attrOf(el.attrs, 'Name') ?? el.name,
          band: el.band ?? 'none',
          expression: el.aggregate,
          running: el.summary ? attrOf(el.summary.attrs, 'Running') ?? 'None' : 'None',
          openEnd: el.openEnd,
          summary: el.summary,
        });
      }
      continue;
    }

    const parent = stack[stack.length - 1];
    if (name === 'Summary' && parent) {
      parent.summary = { start: m.index, end: m.index + whole.length, attrs };
    }
    // A binding item's owner is the element that holds the <ExpressionBindings>.
    if (parent?.name === 'ExpressionBindings' && attrOf(attrs, 'PropertyName') === 'Text') {
      const owner = stack[stack.length - 2];
      const expression = decode(attrOf(attrs, 'Expression') ?? '');
      if (owner && isAggregate(expression)) owner.aggregate = expression;
    }

    if (!selfClosing) {
      const type = attrOf(attrs, 'ControlType') ?? '';
      stack.push({
        name,
        attrs,
        openEnd: m.index + whole.length,
        band: /Band$/.test(type) ? type : parent?.band ?? null,
        summary: null,
        aggregate: null,
      });
    }
  }
  return found;
}

/** Every aggregate-bound control, whether or not it is a problem. */
export function findSummaries(xml: string | undefined | null): SummaryUse[] {
  return scan(xml ?? '').map(({ control, band, expression, running }) => ({ control, band, expression, running }));
}

/** The aggregate cells that print blank, or "?", as the file stands. */
export function findSummaryProblems(xml: string | undefined | null): SummaryProblem[] {
  const out: SummaryProblem[] = [];
  for (const use of findSummaries(xml)) {
    if (use.running === 'None') out.push({ ...use, kind: 'no-running' });
    else if (use.running === 'Group' && use.band === 'ReportFooterBand') out.push({ ...use, kind: 'group-in-report-footer' });
  }
  return out;
}

/**
 * Give each footer total the scope its band implies.
 *
 * Writes `<Summary Running="..." />` as the control's first child, which is
 * where the serializer puts it (before `<ExpressionBindings>`), or sets
 * `Running` on a `<Summary>` that is already there without one. A
 * `Running="Group"` in the report footer becomes `"Report"`: there is no group
 * there, and DevExpress prints "?" for it. No `Ref` is written; the printed
 * measurement showed none is needed, and none means nothing to renumber.
 *
 * Never touches a control outside the two measured bands, and never changes a
 * scope that is already valid there, so running it twice is a no-op.
 */
export function repairSummaries(xml: string | undefined | null): SummaryRepair {
  const text = xml ?? '';
  const edits: { at: number; end: number; insert: string; control: string; band: string; running: BandScope }[] = [];

  for (const use of scan(text)) {
    const scope = SCOPE_BY_BAND[use.band];
    if (!scope) continue;
    const wrong = use.running === 'None' || (use.band === 'ReportFooterBand' && use.running === 'Group');
    if (!wrong) continue;

    if (use.summary) {
      const { start, end, attrs } = use.summary;
      const rewritten = /\sRunning\s*=\s*"[^"]*"/.test(attrs)
        ? text.slice(start, end).replace(/\sRunning\s*=\s*"[^"]*"/, ` Running="${scope}"`)
        : text.slice(start, end).replace(/^<Summary/, `<Summary Running="${scope}"`);
      edits.push({ at: start, end, insert: rewritten, control: use.control, band: use.band, running: scope });
    } else {
      edits.push({ at: use.openEnd, end: use.openEnd, insert: `<Summary Running="${scope}" />`, control: use.control, band: use.band, running: scope });
    }
  }

  if (!edits.length) {
    const left = findSummaryProblems(text).length;
    return {
      xml: text,
      applied: false,
      reason: left
        ? `${left} aggregate(s) lack a scope outside the group and report footers, where the right one is a question of intent`
        : 'every aggregate already has a running scope',
      repaired: [],
    };
  }

  // Back to front, so every earlier offset stays valid.
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.insert + out.slice(edit.end);
  }
  return {
    xml: out,
    applied: true,
    reason: `set the running scope on ${edits.length} total(s): ` +
      edits.map((e) => `${e.control} -> ${e.running}`).join(', '),
    repaired: edits.map(({ control, band, running }) => ({ control, band, running })),
  };
}
