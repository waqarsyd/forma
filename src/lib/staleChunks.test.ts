// @vitest-environment jsdom
/**
 * A tab open across a deploy reloads once for the new build (2026-11-07, site
 * audit item 1), and only once: a chunk that is truly broken must not reload
 * the tab forever.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isStaleChunkError,
  isStaleWaiting,
  onStaleWaiting,
  reloadForStaleChunk,
  reloadIfStaleWaiting,
  RELOAD_WINDOW_MS,
  setStaleBusyCheck,
  shouldReload,
  watchForStaleChunks,
} from './staleChunks';

/** A window whose reload is counted rather than done. */
function fakeWindow() {
  const reload = vi.fn();
  const win = Object.create(window) as Window;
  Object.defineProperty(win, 'location', { value: { reload } });
  Object.defineProperty(win, 'sessionStorage', { value: window.sessionStorage });
  return { win, reload };
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.useRealTimers();
});

describe('isStaleChunkError', () => {
  it("knows each browser's words for a chunk that could not be fetched, and nothing else", () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-1.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe('shouldReload', () => {
  it('reloads the first time, and again only after the window has passed', () => {
    expect(shouldReload(1_000_000, null)).toBe(true);
    expect(shouldReload(1_000_000, 1_000_000 - 5_000)).toBe(false);
    expect(shouldReload(1_000_000, 1_000_000 - RELOAD_WINDOW_MS - 1)).toBe(true);
  });
});

describe('reloading for a stale chunk', () => {
  it('reloads once, then leaves a second failure soon after to the page', () => {
    const { win, reload } = fakeWindow();
    expect(reloadForStaleChunk(win)).toBe(true);
    expect(reloadForStaleChunk(win)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads for Vite's preload error and a failed import, not for any rejection", () => {
    const { win, reload } = fakeWindow();
    const stop = watchForStaleChunks(win);
    const unrelated = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(unrelated, 'reason', { value: new Error('something else') });
    window.dispatchEvent(unrelated);
    expect(reload).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  // The full audit's SA-16 (2026-11-11): a deploy found during a turn does not reload the tab under it.
  it('reloads nothing while a turn runs, says a new version waits, and reloads once the turn has ended', () => {
    const { win, reload } = fakeWindow();
    let turn = true;
    const stopBusy = setStaleBusyCheck(() => turn);
    const onWaiting = vi.fn();
    const stopWaiting = onStaleWaiting(onWaiting);
    const stop = watchForStaleChunks(win);
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(reload).not.toHaveBeenCalled();
    // The failed load takes its own way while the reload waits.
    expect(event.defaultPrevented).toBe(false);
    expect(isStaleWaiting()).toBe(true);
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(reloadForStaleChunk(win)).toBe(false);
    expect(onWaiting).toHaveBeenCalledTimes(1);
    // Still running: nothing yet.
    expect(reloadIfStaleWaiting(win)).toBe(false);
    turn = false;
    expect(reloadIfStaleWaiting(win)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isStaleWaiting()).toBe(false);
    expect(reloadIfStaleWaiting(win)).toBe(false);
    stop();
    stopWaiting();
    stopBusy();
  });
});
