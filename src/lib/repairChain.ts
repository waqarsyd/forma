/**
 * Every repair a generated report goes through, in one function and in one
 * order (2026-11-11, the full audit, ARCH-1a).
 *
 * The passes lived inline in `analyzeReportDesign`, thirteen blocks of a
 * three-thousand-line file, while Forma's own builders ran three of them
 * (`skeletonToDesign`: Refs, Dpi, paper). A report Forma drafted itself and
 * one the AI wrote then reached the user through different repairs, and the
 * order, which is load-bearing, was written down nowhere but in that
 * sequence of blocks. Moved here unchanged, so the generation calls one
 * function and a stand-in draft can call the same one.
 *
 * Why each pass stands where it does is the doc comment of its own module;
 * in short:
 * - **Item names first**, then **Refs**: everything after reads the document
 *   DevExpress will load, and a collection named wrong loads empty.
 * - **Dpi**, then **paper**, before anything that reads geometry: every band
 *   and control is read at its own Dpi, and the page is PaperKind's.
 * - **Margins** next, from the bands as they now stand; **overlaps** only for
 *   a report designed from words, where there is no source to be faithful to.
 * - **Parameters, totals, groups, cross-tabs**: the parts the model writes in
 *   a form DevExpress reads differently, each measured by printing.
 * - **The data source** carried through a redesign, then **stored logins** and
 *   **scripts** removed (2026-11-11, SE-02b: Forma writes no code, so code in
 *   a generated report came from the model unless the user brought it).
 * - **Styles last**: they read every attribute the passes above may write.
 */
import { normalizeItemNames } from './repxItems';
import { ensureUniqueRefs } from './repxRefs';
import { repairDpi } from './repxDpi';
import { repairPaper } from './repxPaper';
import { liftReportMargins } from './repxMargins';
import { resolveOverlaps } from './repxOverlaps';
import { liftParameterTypes } from './repxParameters';
import { repairSummaries } from './repxSummaries';
import { repairGroupLevels } from './repxGroups';
import { repairCrossTabs } from './repxCrossTabs';
import { carryDataSource, stripStoredCredentials } from './repxSqlDataSource';
import { liftStyles } from './repxStyles';
import { hasReportScripts } from './shares';

/** What a repair is asked to know about the report it repairs. */
export interface RepairContext {
  /** The DevExpress version the report is written for, for the parameter lift. */
  version: string;
  /** Designed from a written description: overlapping controls are moved apart. */
  description?: boolean;
  /** The report this one redesigns: its data source is carried over. */
  previous?: string | null;
  /** The user brought code in their own report, so the answer may keep it. */
  keepScripts?: boolean;
}

/** One pass, as it went. */
export interface RepairStep {
  name: RepairName;
  applied: boolean;
  reason: string;
}

/** The passes, in the order they run. */
export const REPAIR_ORDER = [
  'items',
  'refs',
  'dpi',
  'paper',
  'margins',
  'overlaps',
  'parameters',
  'totals',
  'groups',
  'cross-tabs',
  'data source',
  'logins',
  'scripts',
  'styles',
] as const;

export type RepairName = (typeof REPAIR_ORDER)[number];

type Result = { xml: string; applied: boolean; reason: string };

/**
 * `ScriptsSource` and every `<Scripts>` element, removed (SE-02b). DevExpress
 * compiles and runs both when the report is previewed or printed in a
 * designer; the audit's `report-has-scripts` names one that is kept.
 */
export function stripReportScripts(xml: string): Result {
  if (!hasReportScripts(xml) && !/<Scripts\b/.test(xml)) return { xml, applied: false, reason: 'no scripts' };
  const out = xml
    .replace(/\sScriptsSource="[^"]*"/g, '')
    .replace(/<Scripts\b[^>]*\/>/g, '')
    .replace(/<Scripts\b[^>]*>[\s\S]*?<\/Scripts>/g, '');
  return { xml: out, applied: out !== xml, reason: 'removed the code the answer carried; Forma writes none' };
}

/** How a pass is logged when it acts and when it does not; null says nothing. */
const LOGGED: Record<RepairName, [applied: 'warn' | 'log', skipped: 'debug' | 'log' | null]> = {
  items: ['warn', 'debug'],
  refs: ['warn', 'debug'],
  dpi: ['log', 'debug'],
  paper: ['log', 'debug'],
  margins: ['log', 'log'],
  overlaps: ['log', 'debug'],
  parameters: ['log', 'log'],
  totals: ['warn', 'debug'],
  groups: ['warn', 'debug'],
  'cross-tabs': ['warn', 'debug'],
  'data source': ['warn', null],
  logins: ['warn', null],
  scripts: ['warn', null],
  styles: ['log', 'log'],
};

/** Every repair, in `REPAIR_ORDER`, each logged as it was in the generation path. */
export function repairRepx(xml: string, ctx: RepairContext): { xml: string; steps: RepairStep[] } {
  const passes: Record<RepairName, ((text: string) => Result) | null> = {
    items: normalizeItemNames,
    refs: ensureUniqueRefs,
    dpi: repairDpi,
    paper: repairPaper,
    margins: liftReportMargins,
    overlaps: ctx.description ? (text) => resolveOverlaps(text) : null,
    parameters: (text) => liftParameterTypes(text, ctx.version),
    totals: repairSummaries,
    groups: repairGroupLevels,
    'cross-tabs': repairCrossTabs,
    'data source': ctx.previous ? (text) => carryDataSource(ctx.previous!, text) : null,
    logins: stripStoredCredentials,
    scripts: ctx.keepScripts ? null : stripReportScripts,
    styles: liftStyles,
  };
  const steps: RepairStep[] = [];
  let text = xml;
  for (const name of REPAIR_ORDER) {
    const run = passes[name];
    if (!run) continue;
    const result = run(text);
    if (result.applied) text = result.xml;
    steps.push({ name, applied: result.applied, reason: result.reason });
    const level = LOGGED[name][result.applied ? 0 : 1];
    if (level) console[level](`Repair, ${name}: ${result.reason}.`);
  }
  return { xml: text, steps };
}
