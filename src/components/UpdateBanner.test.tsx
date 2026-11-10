// @vitest-environment jsdom
/**
 * A newer Forma taking over the tab is said, with a reload (2026-11-10, the
 * full audit, batch FE); a worker's first claim of a fresh tab is not.
 */
import { describe, expect, it, vi } from 'vitest';
import { watchForUpdate } from './UpdateBanner';

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
