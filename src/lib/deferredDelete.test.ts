/**
 * A project's delete waits for Undo, and deletions never overlap (2026-11-11,
 * the full audit's WS-03 and WS-27); the person's own sign-out keeps the last
 * change before it signs out (WS-18).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deferDeletes, signOutKeeping, UNDO_DELETE_MS } from './deferredDelete';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('deferDeletes', () => {
  it('hides at once and deletes only after the wait', async () => {
    const run = vi.fn(async () => undefined);
    const seen: string[][] = [];
    const deletes = deferDeletes(run, (ids) => seen.push(ids));
    deletes.schedule(['a']);
    expect(seen.at(-1)).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledWith('a');
    expect(seen.at(-1)).toEqual([]);
  });

  it('keeps a row hidden until its deletion has settled, not just the wait', async () => {
    // A signed-in delete takes round trips before the list's entry goes; the
    // row must not come back for them, nor all of a Clear all at once.
    const settle = new Map<string, (ok: boolean) => void>();
    const run = vi.fn(
      (id: string) =>
        new Promise<void>((resolve, reject) => {
          settle.set(id, (ok) => (ok ? resolve() : reject(new Error('refused'))));
        }),
    );
    const seen: string[][] = [];
    const deletes = deferDeletes(run, (ids) => seen.push(ids));
    deletes.schedule(['a', 'b']);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS);
    expect(run).toHaveBeenCalledWith('a');
    expect([...(seen.at(-1) ?? [])].sort()).toEqual(['a', 'b']);
    // Under way, so neither waiting nor something Undo can take back.
    expect(deletes.pending()).toEqual([]);
    expect(deletes.undo(['a'])).toBe(false);
    settle.get('a')!(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.at(-1)).toEqual(['b']);
    // A refused deletion lets its row come back.
    settle.get('b')!(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.at(-1)).toEqual([]);
  });

  it('keeps the project when Undo comes within the wait', async () => {
    const run = vi.fn(async () => undefined);
    const deletes = deferDeletes(run, () => undefined);
    deletes.schedule(['a', 'b']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(deletes.undo(['a', 'b'])).toBe(true);
    expect(deletes.pending()).toEqual([]);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS * 2);
    expect(run).not.toHaveBeenCalled();
    // Too late to take back once it has run.
    deletes.schedule(['c']);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS);
    expect(deletes.undo(['c'])).toBe(false);
  });

  it('deletes the rest of a group when only some are taken back', async () => {
    const run = vi.fn(async () => undefined);
    const deletes = deferDeletes(run, () => undefined);
    deletes.schedule(['a', 'b']);
    deletes.undo(['a']);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS);
    expect(run.mock.calls).toEqual([['b']]);
  });

  it('runs deletions one after another, never two at once (WS-27)', async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const run = vi.fn(async (id: string) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 100));
      order.push(id);
      running -= 1;
    });
    const deletes = deferDeletes(run, () => undefined);
    deletes.schedule(['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(50);
    deletes.schedule(['d']);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS + 1000);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(most).toBe(1);
  });

  it('goes on to the next when one deletion throws', async () => {
    const run = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('refused');
    });
    const deletes = deferDeletes(run, () => undefined);
    deletes.schedule(['a', 'b']);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS);
    expect(run.mock.calls).toEqual([['a'], ['b']]);
  });

  it('runs what waits at once on flush, and not again when its timer fires', async () => {
    const run = vi.fn(async () => undefined);
    const deletes = deferDeletes(run, () => undefined);
    deletes.schedule(['a']);
    await deletes.flush();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(deletes.flush()).resolves.toBeUndefined();
  });
});

describe('signOutKeeping', () => {
  it('keeps the last change, then signs out, then clears the browser', async () => {
    const steps: string[] = [];
    await signOutKeeping({
      keep: async () => {
        // A save that answers a few turns later, as a request does.
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
        steps.push('keep');
      },
      logOut: async () => {
        steps.push('logOut');
      },
      forget: () => steps.push('forget'),
    });
    expect(steps).toEqual(['keep', 'logOut', 'forget']);
  });

  it('signs out and clears even when the save or the sign-out fails', async () => {
    const forget = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await signOutKeeping({
      keep: () => Promise.reject(new Error('offline')),
      logOut: () => Promise.reject(new Error('network')),
      forget,
    });
    expect(forget).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
