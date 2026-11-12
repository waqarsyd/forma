/**
 * Where an error caught on the page goes (2026-11-12, lib/errorSink.ts):
 * nowhere without a sink, and the page's own listeners only while there is one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasErrorSink, reportError, setErrorSink } from './errorSink';

/** A window that keeps its listeners, so a test can fire them. */
function fakeWindow() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    listeners,
    addEventListener: (type: string, fn: EventListener) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: EventListener) => void listeners.get(type)?.delete(fn),
    fire: (type: string, event: unknown) => listeners.get(type)?.forEach((fn) => fn(event as Event)),
  };
}

afterEach(() => setErrorSink(null, null));

describe('errorSink', () => {
  it('sends nothing anywhere without a sink', () => {
    expect(hasErrorSink()).toBe(false);
    expect(() => reportError('the Preview', new Error('x'))).not.toThrow();
  });

  it('hands errors to the sink, and a sink that throws is not a second error', () => {
    const sink = vi.fn();
    setErrorSink(sink, null);
    reportError('the spec', new Error('x'));
    expect(sink).toHaveBeenCalledWith('the spec', expect.any(Error));
    setErrorSink(() => {
      throw new Error('broken sink');
    }, null);
    expect(() => reportError('the spec', new Error('y'))).not.toThrow();
  });

  it('listens for what nothing caught while a sink is set, and stops with it', () => {
    const win = fakeWindow();
    const sink = vi.fn();
    setErrorSink(sink, win);
    win.fire('error', { error: new TypeError('a') });
    win.fire('unhandledrejection', { reason: new RangeError('b') });
    expect(sink.mock.calls.map((c) => c[0])).toEqual(['uncaught', 'rejection']);
    setErrorSink(null, win);
    expect(win.listeners.get('error')?.size).toBe(0);
    expect(win.listeners.get('unhandledrejection')?.size).toBe(0);
    win.fire('error', { error: new TypeError('c') });
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
