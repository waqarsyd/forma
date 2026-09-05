/**
 * Going back, and knowing what a change actually did.
 *
 * ## The fear this removes
 *
 * A refinement turn regenerates the whole report. Sometimes it comes back
 * worse, and until now there was no way back — the previous version was simply
 * gone, and saving overwrites. That is not merely inconvenient: it quietly
 * discourages experimenting, which is the one thing a refinement loop is for.
 *
 * ## What counts as a revision, and what does not
 *
 * Milestones, not keystrokes: each generation or refinement, and each binding
 * pass. Dragging a control does NOT push one — direct manipulation has its own
 * undo stack in `ReportPreview`, one entry per gesture, and duplicating that
 * here would bury the three or four revisions a person actually wants to return
 * to under forty nudges of a label.
 *
 * The two mechanisms answer different questions. Undo is "take that back";
 * a revision is "what did this report look like before I asked for that".
 *
 * ## In memory, deliberately, for now
 *
 * Revisions are not saved to the cloud, and that is a decision rather than an
 * omission. A saved report is budgeted at 900 kB (see `persistence.md`) and one
 * `result` — markdown, layout and REPX — can be 50–200 kB on its own, so ten
 * revisions inline would exceed the budget several times over. Doing it
 * properly needs a Firestore subcollection, its own rules, its own rules tests,
 * and a change to account deletion, since deleting a document does not delete
 * the subcollection beneath it. That is a real piece of work and it deserves
 * its own decision, not to be smuggled in under a budget it would break.
 */

/** The part of a report a revision has to be able to restore. */
export interface RevisionSnapshot {
  content: string;
  repxContent: string;
  title: string;
  /** Carried opaquely: this module never reads inside it. */
  layout?: unknown;
}

export interface Revision {
  /** Monotonic within a session; also the React key. */
  id: number;
  /** What produced it, in the user's terms. */
  label: string;
  at: number;
  snapshot: RevisionSnapshot;
}

/**
 * How many to keep.
 *
 * Bounded because a long session of refinements would otherwise hold every
 * intermediate report in memory, and the ones worth returning to are recent.
 * Twenty is roughly a working session; the oldest is dropped first.
 */
export const MAX_REVISIONS = 20;

export interface PushOptions {
  max?: number;
  now?: number;
}

/**
 * Add a revision, unless it would be a duplicate of the newest one.
 *
 * The duplicate check is on the REPX, because that is the artifact: a
 * refinement that changed only the markdown wording has not changed the report,
 * and a list where half the entries are identical files is a list nobody reads.
 * A first revision is always kept.
 */
export function pushRevision(
  list: readonly Revision[],
  label: string,
  snapshot: RevisionSnapshot,
  options: PushOptions = {},
): Revision[] {
  const max = options.max ?? MAX_REVISIONS;
  const newest = list[0];
  if (newest && newest.snapshot.repxContent === snapshot.repxContent) return [...list];

  const next: Revision = {
    id: (newest?.id ?? 0) + 1,
    label,
    at: options.now ?? Date.now(),
    snapshot,
  };
  // Newest first: the list is read top-down and the interesting end is the
  // recent one.
  return [next, ...list].slice(0, max);
}

// ------------------------------------------------------------------- diffing

export interface ReportDiff {
  /** Control names present in `next` and not in `previous`. */
  added: string[];
  removed: string[];
  /** Present in both, with different geometry or text. */
  changed: string[];
  /** Content bands, before and after. */
  bands: { from: number; to: number };
  /** REPX size in bytes, before and after. */
  bytes: { from: number; to: number };
}

/**
 * A control as the diff sees it: its name and the things worth noticing.
 *
 * Matched by `Name` rather than by position, because a control added near the
 * top would otherwise report every control below it as changed. DevExpress
 * names are unique within a report in practice, and a duplicate simply means
 * the later one wins here — a diff is a summary, not a merge.
 */
const CONTROL = /<Item\d+\s[^>]*ControlType="(XR[A-Za-z]+)"[^>]*>/g;
const attrOf = (tag: string, name: string): string =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1] ?? '';

function controlSignatures(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  CONTROL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONTROL.exec(xml)) !== null) {
    const tag = m[0];
    const name = attrOf(tag, 'Name');
    if (!name) continue;
    // Position, size and text: the three a person means by "did this change".
    // Font and colour deliberately do not count -- a restyle is not a
    // structural change and listing it would drown the ones that are.
    out.set(name, [
      attrOf(tag, 'LocationFloat'),
      attrOf(tag, 'SizeF'),
      attrOf(tag, 'Text'),
    ].join('|'));
  }
  return out;
}

const CONTENT_BAND = /ControlType="(?!TopMarginBand|BottomMarginBand)\w*Band"/g;

/**
 * What changed between two versions of a report.
 *
 * Structural only, and reported by control name so the answer is something a
 * person can look for in the file. It does not attempt a text diff of the XML:
 * the model rewrites whitespace and attribute order freely between generations,
 * so a line diff of two REPX files is almost entirely noise.
 */
export function diffReports(previous: string, next: string): ReportDiff {
  const before = controlSignatures(previous);
  const after = controlSignatures(next);

  const added: string[] = [];
  const changed: string[] = [];
  for (const [name, signature] of after) {
    if (!before.has(name)) added.push(name);
    else if (before.get(name) !== signature) changed.push(name);
  }
  const removed = [...before.keys()].filter((name) => !after.has(name));

  return {
    added,
    removed,
    changed,
    bands: {
      from: (previous.match(CONTENT_BAND) ?? []).length,
      to: (next.match(CONTENT_BAND) ?? []).length,
    },
    bytes: { from: previous.length, to: next.length },
  };
}

/**
 * The diff as one line, or empty when nothing structural moved.
 *
 * Empty rather than "no changes" so the caller decides whether saying nothing
 * is better than saying that — a revision list reads better with a blank than
 * with a column of "no changes".
 */
export function describeDiff(diff: ReportDiff): string {
  const parts: string[] = [];
  if (diff.bands.from !== diff.bands.to) {
    parts.push(`${diff.bands.from} → ${diff.bands.to} bands`);
  }
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  if (diff.changed.length) parts.push(`${diff.changed.length} changed`);
  return parts.join(' · ');
}
