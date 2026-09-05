/**
 * A folder of legacy reports in, a queue of `.repx` out.
 *
 * ## Why this is a different thing from attaching several files
 *
 * The composer already takes several files, and it means one report assembled
 * from several pages. This means the opposite: N source documents, N separate
 * reports, one job each. The two cannot be told apart from the files, so the
 * distinction has to be made by where the user drops them — which is why batch
 * intake is its own panel rather than a checkbox on the composer.
 *
 * It is also the migration story, and the one thing a prompt-driven competitor
 * structurally cannot offer: you can describe one report to an assistant, but
 * you cannot describe forty you have never read.
 *
 * ## Sequential, deliberately
 *
 * One generation at a time. The user's own key carries the quota, and Gemini's
 * free tier is rate-limited per minute — firing forty requests at once turns a
 * slow success into a fast 429. Sequential also makes Stop mean something: the
 * item in flight is the only one that can be wasted.
 *
 * ## Pure
 *
 * Every function here returns a new queue rather than mutating one, so the
 * component holds it in state and React sees each transition. Nothing in this
 * file knows about Gemini, fetch, or the DOM.
 */

export type BatchStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface BatchItem {
  /** Stable across the queue's life; used as the React key. */
  id: string;
  /** The source file's own name, shown to the user. */
  sourceName: string;
  status: BatchStatus;
  /** The model's report title, once there is one. */
  title: string;
  /** The generated REPX, once there is one. */
  repxContent: string;
  /** Content bands, from the layout. Shown as a sanity figure per row. */
  bands: number;
  /** Structural findings, worst first, as `repxAudit` counts them. */
  errors: number;
  warnings: number;
  /** Why it failed, or why it was skipped. Empty on success. */
  message: string;
}

export interface BatchSummary {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  /** Finished items carrying a REPX — what "Download all" would archive. */
  downloadable: number;
  /** True when nothing is pending or running. */
  finished: boolean;
  /** Files whose report has at least one structural error. */
  withErrors: number;
  withWarnings: number;
}

/**
 * A queue from a set of files.
 *
 * Ids are index-based rather than random so a queue built twice from the same
 * files is identical, which keeps the component's keys stable across a re-run
 * and makes the tests deterministic. Nothing here needs unguessability.
 */
export function createQueue(names: readonly string[]): BatchItem[] {
  return names.map((sourceName, index) => ({
    id: `${index}:${sourceName}`,
    sourceName,
    status: 'pending' as BatchStatus,
    title: '',
    repxContent: '',
    bands: 0,
    errors: 0,
    warnings: 0,
    message: '',
  }));
}

/** The next item to run, or null when there is nothing left to start. */
export function nextPending(queue: readonly BatchItem[]): BatchItem | null {
  return queue.find((item) => item.status === 'pending') ?? null;
}

/** Replace one item, by id. The single mutation primitive everything else uses. */
export function updateItem(
  queue: readonly BatchItem[],
  id: string,
  patch: Partial<BatchItem>,
): BatchItem[] {
  return queue.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function markRunning(queue: readonly BatchItem[], id: string): BatchItem[] {
  return updateItem(queue, id, { status: 'running', message: '' });
}

export interface BatchOutcome {
  title: string;
  repxContent: string;
  bands: number;
  errors: number;
  warnings: number;
}

export function markDone(queue: readonly BatchItem[], id: string, outcome: BatchOutcome): BatchItem[] {
  return updateItem(queue, id, { status: 'done', ...outcome, message: '' });
}

export function markFailed(queue: readonly BatchItem[], id: string, message: string): BatchItem[] {
  return updateItem(queue, id, { status: 'failed', message });
}

/**
 * Stop: cancel what has not started, and leave what has.
 *
 * The running item is deliberately untouched. Its request is already in flight
 * and already being billed to the user's key, so throwing the answer away would
 * cost them the call and give them nothing — the component aborts the request
 * separately and reports the outcome either way.
 */
export function cancelPending(queue: readonly BatchItem[]): BatchItem[] {
  return queue.map((item) =>
    item.status === 'pending'
      ? { ...item, status: 'cancelled' as BatchStatus, message: 'stopped before this file started' }
      : item,
  );
}

/** Put the failed and cancelled items back in the queue, keeping what succeeded. */
export function retryUnfinished(queue: readonly BatchItem[]): BatchItem[] {
  return queue.map((item) =>
    item.status === 'failed' || item.status === 'cancelled'
      ? { ...item, status: 'pending' as BatchStatus, message: '' }
      : item,
  );
}

export function summarise(queue: readonly BatchItem[]): BatchSummary {
  const count = (status: BatchStatus) => queue.filter((i) => i.status === status).length;
  const pending = count('pending');
  const running = count('running');
  const done = queue.filter((i) => i.status === 'done');
  return {
    total: queue.length,
    pending,
    running,
    done: done.length,
    failed: count('failed'),
    cancelled: count('cancelled'),
    downloadable: done.filter((i) => i.repxContent).length,
    finished: pending === 0 && running === 0,
    withErrors: done.filter((i) => i.errors > 0).length,
    withWarnings: done.filter((i) => i.errors === 0 && i.warnings > 0).length,
  };
}

/**
 * A one-line verdict per item, in the words the audit uses.
 *
 * The point of batch intake is not that forty files came out; it is knowing
 * which of the forty are worth opening. So the row says what the audit found
 * rather than only that the job finished.
 */
export function verdict(item: BatchItem): string {
  switch (item.status) {
    case 'pending': return 'waiting';
    case 'running': return 'generating…';
    case 'cancelled': return item.message || 'cancelled';
    case 'failed': return item.message || 'failed';
    case 'done':
      if (!item.repxContent) return 'no REPX was produced';
      if (item.errors) return `${item.errors} error${item.errors > 1 ? 's' : ''} — content will be lost`;
      if (item.warnings) return `${item.warnings} warning${item.warnings > 1 ? 's' : ''}`;
      return 'clean';
  }
}

/**
 * The `.repx` name for an item.
 *
 * The report's own title when it has one, because that is what the user will
 * look for; the source file's name otherwise, with its extension replaced. A
 * batch of forty files named after the images they came from is not a set of
 * reports anyone can find anything in.
 */
export function outputName(item: BatchItem): string {
  const base = (item.title || item.sourceName.replace(/\.[^.]+$/, '') || 'report').trim();
  return `${base}.repx`;
}
