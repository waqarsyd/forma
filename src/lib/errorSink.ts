/**
 * Where an error caught on the page goes (2026-11-12, Owner decision 10, the
 * full audit's SA-15): nowhere, unless the person turned on "Send error
 * reports" in Settings and is signed in, when the workspace hands this a sink
 * (lib/errorReport.ts, which scrubs, de-duplicates and sends).
 *
 * Kept this small on purpose: the error boundaries import it, and the
 * boundary around everything is in the entry chunk every visitor loads. All
 * the work, and every word of what may be sent, is in the lazy module.
 *
 * With a sink set, an error nothing caught (`error`) and a promise rejected
 * with nobody waiting on it (`unhandledrejection`) reach it too; without one,
 * nothing listens.
 */
export type ErrorSink = (area: string, error: unknown) => void;

let sink: ErrorSink | null = null;
let unwatch: (() => void) | null = null;

/** Hands an error to the sink, if there is one. Never throws. */
export function reportError(area: string, error: unknown): void {
  try {
    sink?.(area, error);
  } catch {
    /* a report that fails is not a second error */
  }
}

/** The sink, or null for none; the page's own listeners come and go with it. */
export function setErrorSink(next: ErrorSink | null, win: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window === 'undefined' ? null : window): void {
  sink = next;
  if (next && !unwatch && win) {
    const onError = (e: ErrorEvent) => reportError('uncaught', e.error ?? null);
    const onRejection = (e: PromiseRejectionEvent) => reportError('rejection', e.reason);
    win.addEventListener('error', onError as EventListener);
    win.addEventListener('unhandledrejection', onRejection as EventListener);
    unwatch = () => {
      win.removeEventListener('error', onError as EventListener);
      win.removeEventListener('unhandledrejection', onRejection as EventListener);
    };
  } else if (!next && unwatch) {
    unwatch();
    unwatch = null;
  }
}

/** Whether a sink is set: for tests. */
export function hasErrorSink(): boolean {
  return sink !== null;
}
