// @vitest-environment jsdom
/**
 * A newer Forma taking over the tab is said, with a reload (2026-11-10, the
 * full audit, batch FE); a worker's first claim of a fresh tab is not. Since
 * 2026-11-11 (SA-16, WS-47): an open tab asks for a newer build on its own,
 * a build found during a turn waits for it to end, and the notice can be
 * dismissed and sits under the dialogs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import UpdateBanner, { checkForUpdates, UPDATE_CHECK_MS, watchForUpdate } from './UpdateBanner';
import { reloadForStaleChunk, setStaleBusyCheck } from '../lib/staleChunks';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

function container(controller: unknown) {
  const target = new EventTarget();
  return {
    controller,
    addEventListener: (type: string, fn: () => void) => target.addEventListener(type, fn),
    removeEventListener: (type: string, fn: () => void) => target.removeEventListener(type, fn),
    fire: () => target.dispatchEvent(new Event('controllerchange')),
  };
}

describe('watching for a new version', () => {
  it('says so when a tab that had a worker gets another, and stops when told', () => {
    const c = container({});
    const onUpdate = vi.fn();
    const stop = watchForUpdate(onUpdate, c);
    c.fire();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    stop();
    c.fire();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('says nothing on a first visit, when the first worker takes the page', () => {
    const c = container(null);
    const onUpdate = vi.fn();
    watchForUpdate(onUpdate, c);
    c.fire();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('does nothing where there is no service worker', () => {
    expect(() => watchForUpdate(vi.fn(), undefined)()).not.toThrow();
  });
});

describe('asking for a newer build', () => {
  it('asks every half hour and whenever the tab is shown again, and stops when told', () => {
    vi.useFakeTimers();
    const update = vi.fn(async () => undefined);
    const stop = checkForUpdates({ update });
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(update).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(update).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(UPDATE_CHECK_MS * 2);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('survives a check that fails', () => {
    vi.useFakeTimers();
    const stop = checkForUpdates({ update: () => Promise.reject(new Error('offline')) });
    expect(() => vi.advanceTimersByTime(UPDATE_CHECK_MS)).not.toThrow();
    stop();
  });
});

describe('the notice', () => {
  it('says a build found during a turn reloads when the turn finishes, under the dialogs, and can be dismissed', () => {
    window.history.replaceState({}, '', '/workspace');
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).toBeNull();
    const stopBusy = setStaleBusyCheck(() => true);
    const reload = vi.fn();
    const win = Object.create(window) as Window;
    Object.defineProperty(win, 'location', { value: { reload } });
    Object.defineProperty(win, 'sessionStorage', { value: window.sessionStorage });
    act(() => {
      expect(reloadForStaleChunk(win)).toBe(false);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText('Forma has a new version. It reloads when this finishes.')).toBeTruthy();
    // It reloads on its own when the turn ends; "Reload now" is for someone who would rather not wait.
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeTruthy();
    const pill = screen.getByRole('status');
    expect(pill.className).toContain('z-[55]');
    // At the top of the workspace, clear of the message box.
    expect(pill.className).toContain('top-14');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Forma has a new version/)).toBeNull();
    stopBusy();
  });
});
