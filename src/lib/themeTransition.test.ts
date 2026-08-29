// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { coverRadius, originOf, canAnimateSwap, circularThemeSwap } from './themeTransition';

/**
 * The geometry is the part that fails silently: a radius that is too small
 * stops the wipe short of a corner and it snaps, which reads as a rendering
 * fault rather than as a wrong number. The fallbacks are the other half —
 * a theme toggle that does nothing on a browser without the API would be far
 * worse than one that does not animate.
 */

const mq = (reduce: boolean) =>
  vi.fn().mockImplementation((q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

describe('coverRadius', () => {
  it('reaches the far corner from a corner origin', () => {
    // from (0,0) of a 300x400 box the furthest point is (300,400)
    expect(coverRadius(0, 0, 300, 400)).toBeCloseTo(500);
  });

  it('reaches the far corner from the opposite corner', () => {
    expect(coverRadius(300, 400, 300, 400)).toBeCloseTo(500);
  });

  it('is half the diagonal from the centre', () => {
    expect(coverRadius(150, 200, 300, 400)).toBeCloseTo(250);
  });

  it('takes the further side on each axis, not the nearer one', () => {
    // The toggle sits top-right, so the far corner is bottom-left. Measuring to
    // the near edge would give hypot(40, 60) = 72 and stop the wipe short.
    const r = coverRadius(960, 60, 1000, 800);
    expect(r).toBeCloseTo(Math.hypot(960, 740));
    expect(r).toBeGreaterThan(1200);
  });

  it('covers every corner it is asked about', () => {
    const [w, h] = [1440, 900];
    for (const [x, y] of [[0, 0], [1440, 0], [0, 900], [1440, 900], [700, 20], [12, 880]]) {
      const r = coverRadius(x, y, w, h);
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
        expect(r).toBeGreaterThanOrEqual(Math.hypot(cx - x, cy - y) - 0.001);
      }
    }
  });
});

describe('originOf', () => {
  it('takes the centre of the element', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () =>
      ({ left: 100, top: 40, width: 40, height: 20 }) as DOMRect;
    expect(originOf(el, 1000, 800)).toEqual({ x: 120, y: 50 });
  });

  it('falls back to the viewport centre when there is no element', () => {
    expect(originOf(null, 1000, 800)).toEqual({ x: 500, y: 400 });
  });

  it('treats a zero-sized rect as absent', () => {
    // What a detached or display:none element reports. Wiping from 0,0 would
    // look like a glitch rather than a decision.
    const el = document.createElement('button');
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    expect(originOf(el, 1000, 800)).toEqual({ x: 500, y: 400 });
  });
});

describe('canAnimateSwap', () => {
  it('is false when the browser has no View Transitions API', () => {
    vi.stubGlobal('matchMedia', mq(false));
    expect(canAnimateSwap()).toBe(false);
  });

  it('is false under prefers-reduced-motion, even with the API', () => {
    (document as { startViewTransition?: unknown }).startViewTransition = () => {};
    vi.stubGlobal('matchMedia', mq(true));
    expect(canAnimateSwap()).toBe(false);
  });

  it('is true with the API and motion allowed', () => {
    (document as { startViewTransition?: unknown }).startViewTransition = () => {};
    vi.stubGlobal('matchMedia', mq(false));
    expect(canAnimateSwap()).toBe(true);
  });
});

describe('circularThemeSwap', () => {
  it('still applies the change when it cannot animate, and says so', () => {
    vi.stubGlobal('matchMedia', mq(false));
    const swap = vi.fn();
    expect(circularThemeSwap(swap)).toBe(false);
    expect(swap).toHaveBeenCalledOnce();
  });

  it('applies the change exactly once under reduced motion', () => {
    (document as { startViewTransition?: unknown }).startViewTransition = () => {};
    vi.stubGlobal('matchMedia', mq(true));
    const swap = vi.fn();
    expect(circularThemeSwap(swap)).toBe(false);
    expect(swap).toHaveBeenCalledOnce();
  });

  it('hands the swap to the API and reports that it animated', () => {
    const start = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve() };
    });
    (document as { startViewTransition?: unknown }).startViewTransition = start;
    vi.stubGlobal('matchMedia', mq(false));
    document.documentElement.animate = vi.fn() as never;

    const swap = vi.fn();
    expect(circularThemeSwap(swap)).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(swap).toHaveBeenCalledOnce();
  });

  it('survives a transition that is skipped', async () => {
    // A second click, or the page being hidden, rejects `ready`. The DOM change
    // has already been applied, so this must not throw or double-apply.
    const start = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.reject(new Error('skipped')), finished: Promise.resolve() };
    });
    (document as { startViewTransition?: unknown }).startViewTransition = start;
    vi.stubGlobal('matchMedia', mq(false));

    const swap = vi.fn();
    expect(() => circularThemeSwap(swap)).not.toThrow();
    await Promise.resolve();
    expect(swap).toHaveBeenCalledOnce();
  });
});
