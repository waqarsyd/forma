/**
 * The overload cooldown.
 *
 * Both request paths already move to another model *within* one request, and
 * neither caches the fallback — deliberately, because the preferred model
 * should be tried again once capacity returns rather than abandoned for the
 * session. The gap was between requests: during a sustained outage every new
 * turn started again on the model Google had just refused, spent both retries
 * and roughly six seconds of backoff, and only then fell back. Reported from a
 * real session on 2026-09-08.
 *
 * Time is injected throughout rather than faked globally: these are pure
 * functions over a clock, and passing `now` states each case in one line.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  OVERLOAD_COOLDOWN_MS,
  clearCachedModel,
  isModelInCooldown,
  noteModelOverloaded,
  startingModel,
} from './modelCache';

const T0 = 1_800_000_000_000;

beforeEach(() => {
  // Also clears the cooldown map, which is the point of it being in here.
  clearCachedModel();
});

describe('isModelInCooldown', () => {
  it('is false for a model that has never failed', () => {
    expect(isModelInCooldown('never-seen', T0)).toBe(false);
  });

  it('is true immediately after an overload', () => {
    noteModelOverloaded('busy', T0);
    expect(isModelInCooldown('busy', T0)).toBe(true);
  });

  it('is still true just before the window closes', () => {
    noteModelOverloaded('busy', T0);
    expect(isModelInCooldown('busy', T0 + OVERLOAD_COOLDOWN_MS - 1)).toBe(true);
  });

  it('has expired once the window passes', () => {
    noteModelOverloaded('busy', T0);
    expect(isModelInCooldown('busy', T0 + OVERLOAD_COOLDOWN_MS)).toBe(false);
  });

  // Otherwise a long session accumulates one entry per model that ever hiccuped.
  it('forgets an expired entry rather than keeping it forever', () => {
    noteModelOverloaded('busy', T0);
    expect(isModelInCooldown('busy', T0 + OVERLOAD_COOLDOWN_MS)).toBe(false);
    // Asking again at the original instant would report true if the entry were
    // still there; it is gone, so the answer is false whatever clock is used.
    expect(isModelInCooldown('busy', T0)).toBe(false);
  });

  it('tracks models independently', () => {
    noteModelOverloaded('busy', T0);
    expect(isModelInCooldown('other', T0)).toBe(false);
  });
});

describe('startingModel', () => {
  const set = ['first', 'second', 'third'];

  it('keeps the preferred model when nothing is wrong with it', () => {
    expect(startingModel('first', set, T0)).toBe('first');
  });

  // The whole point: the next turn does not open by rediscovering the 503.
  it('steps past a model that was refused for capacity moments ago', () => {
    noteModelOverloaded('first', T0);
    expect(startingModel('first', set, T0 + 1_000)).toBe('second');
  });

  it('returns to the preferred model once its cooldown expires', () => {
    noteModelOverloaded('first', T0);
    expect(startingModel('first', set, T0 + OVERLOAD_COOLDOWN_MS)).toBe('first');
  });

  it('skips as many cooling models as it has to', () => {
    noteModelOverloaded('first', T0);
    noteModelOverloaded('second', T0);
    expect(startingModel('first', set, T0 + 1_000)).toBe('third');
  });

  // Refusing to send anything would be worse than trying a busy model: the
  // per-request retry and fallback still run from wherever this starts.
  it('falls back to the preferred model when everything is cooling down', () => {
    for (const m of set) noteModelOverloaded(m, T0);
    expect(startingModel('first', set, T0 + 1_000)).toBe('first');
  });

  it('copes with no known candidate set', () => {
    noteModelOverloaded('first', T0);
    expect(startingModel('first', null, T0 + 1_000)).toBe('first');
  });

  it('never suggests the preferred model twice over', () => {
    noteModelOverloaded('first', T0);
    expect(startingModel('first', ['first'], T0 + 1_000)).toBe('first');
  });
});
