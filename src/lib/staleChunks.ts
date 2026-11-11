/**
 * A tab open across a deploy (2026-11-07, site audit item 1). Its page names
 * the chunks of the build it was loaded from; a deploy replaces them, and the
 * next lazy load (the workspace's Preview, Markdown, a dialog) asks for a
 * file that is gone. Firebase answered that with the home page and a 200,
 * cached for a year; since the same day it answers 404 (`appRoutes.ts`), and
 * the import fails. Then the page reloads itself once, as Vercel's and
 * Netlify's apps do, and gets the new build; what the person had is kept, as
 * a reload keeps it (the autosave and the draft are flushed on `pagehide`).
 *
 * Once: a second failure within `RELOAD_WINDOW_MS` of the last reload is left
 * to the page's own error, so a chunk that is truly broken cannot reload the
 * tab forever.
 */

/** How soon after a reload another stale chunk is taken as a real failure. */
export const RELOAD_WINDOW_MS = 30_000;
const KEY = 'forma:staleReloadAt';

/** What a failed lazy load says, in Chrome, Firefox and Safari. */
const STALE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** Whether an error is a lazy load of a chunk that could not be fetched. */
export function isStaleChunkError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  return STALE.test(message);
}

/** Whether to reload now, given when the last reload for this was (ms, or null for never). */
export function shouldReload(now: number, last: number | null): boolean {
  return last === null || now - last > RELOAD_WINDOW_MS;
}

/*
 * Never in the middle of a turn (2026-11-11, the full audit's SA-16). A lazy
 * load that failed while Forma was writing a reply or a report reloaded the
 * page there and then, and the turn was lost: the message was kept and
 * marked as interrupted, the work was not. Now App says when a turn runs
 * (`setStaleBusyCheck`), a stale chunk found during one waits, the update
 * notice says Forma reloads when this finishes, and App calls
 * `reloadIfStaleWaiting` as the turn ends.
 */
let busy: () => boolean = () => false;
let waiting = false;
const waitingListeners = new Set<() => void>();

/** App's way of saying a turn is running; returns the way to stop asking. */
export function setStaleBusyCheck(check: () => boolean): () => void {
  busy = check;
  return () => {
    if (busy === check) busy = () => false;
  };
}

/** Whether a new build is waiting for the running turn to end. */
export function isStaleWaiting(): boolean {
  return waiting;
}

/** Calls `onWaiting` when a reload starts waiting for a turn; returns the way to stop. */
export function onStaleWaiting(onWaiting: () => void): () => void {
  waitingListeners.add(onWaiting);
  return () => void waitingListeners.delete(onWaiting);
}

/** Reloads for the waiting build once nothing runs; true when it reloads. */
export function reloadIfStaleWaiting(win: Window = window): boolean {
  if (!waiting || busy()) return false;
  waiting = false;
  return reloadForStaleChunk(win);
}

/**
 * Reloads the page for a stale chunk unless it did so just now; true when it
 * reloads. The error boundary in main.tsx asks this too, for a lazy component
 * whose chunk is gone, which React hands to the boundary, not to a listener.
 * While a turn runs it reloads nothing and returns false, so the failed load
 * takes its ordinary way, and the reload waits for the turn to end.
 */
export function reloadForStaleChunk(win: Window = window): boolean {
  if (busy()) {
    if (!waiting) {
      waiting = true;
      for (const listener of waitingListeners) listener();
    }
    return false;
  }
  let last: number | null = null;
  try {
    const kept = win.sessionStorage.getItem(KEY);
    last = kept ? Number(kept) : null;
  } catch {
    /* no storage: reload anyway; the window check cannot hold without it */
  }
  if (!shouldReload(Date.now(), last)) return false;
  try {
    win.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* as above */
  }
  win.location.reload();
  return true;
}

/** Listens for a stale chunk and reloads once; returns the way to stop. */
export function watchForStaleChunks(win: Window = window): () => void {
  const reloadOnce = (event: Event) => {
    if (reloadForStaleChunk(win)) event.preventDefault();
  };
  // Vite's own signal for a lazy import whose chunk or CSS did not load.
  const onPreload = (event: Event) => reloadOnce(event);
  // And an import that failed outside Vite's preload helper.
  const onRejection = (event: PromiseRejectionEvent) => {
    if (isStaleChunkError(event.reason)) reloadOnce(event);
  };
  win.addEventListener('vite:preloadError', onPreload);
  win.addEventListener('unhandledrejection', onRejection);
  return () => {
    win.removeEventListener('vite:preloadError', onPreload);
    win.removeEventListener('unhandledrejection', onRejection);
  };
}
