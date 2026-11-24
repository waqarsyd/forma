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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OVERLOAD_COOLDOWN_MS,
  cacheModel,
  clearCachedModel,
  isModelInCooldown,
  keepModelChoiceIn,
  keptParks,
  keyTag,
  noteModelLimited,
  noteModelOverloaded,
  onModelCacheChange,
  restoreParks,
  startingModel,
  type ModelPark,
  type ParkStore,
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

describe('a cooldown of a stated length', () => {
  /*
   * A 503 says nothing about when capacity returns, so it takes the default
   * minute. A 429 states the reset exactly, and honouring that number is the
   * difference between waiting the right amount and spending another request
   * to be told again — 20% of a free-tier minute, at five per minute.
   */
  it('honours a shorter window than the default', () => {
    noteModelOverloaded('limited', T0, 2_049);
    expect(isModelInCooldown('limited', T0 + 2_000)).toBe(true);
    expect(isModelInCooldown('limited', T0 + 2_049)).toBe(false);
  });

  it('honours a longer window than the default', () => {
    noteModelOverloaded('limited', T0, 55_000);
    // Past the default minute would have expired; this one has not.
    expect(isModelInCooldown('limited', T0 + 54_000)).toBe(true);
  });

  it('still defaults when no window is given', () => {
    noteModelOverloaded('busy', T0);
    expect(isModelInCooldown('busy', T0 + OVERLOAD_COOLDOWN_MS - 1)).toBe(true);
    expect(isModelInCooldown('busy', T0 + OVERLOAD_COOLDOWN_MS)).toBe(false);
  });

  it('lets a later note extend an earlier one', () => {
    noteModelOverloaded('busy', T0, 1_000);
    noteModelOverloaded('busy', T0, 30_000);
    expect(isModelInCooldown('busy', T0 + 5_000)).toBe(true);
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

/*
 * The chat box's model menu reads this cache, and Check key fills it after the
 * key was typed: until 2026-11-09 nothing told the menu, so it named no model
 * until a reload. The cache now says when it moves.
 */
describe('onModelCacheChange', () => {
  it('tells a listener when the models are found or cleared, until it unsubscribes', () => {
    const listener = vi.fn();
    const stop = onModelCacheChange(listener);
    cacheModel('gemini-flash', ['gemini-flash', 'gemini-flash-lite']);
    expect(listener).toHaveBeenCalledTimes(1);
    clearCachedModel();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    cacheModel('gemini-flash');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('tells every listener even when one throws', () => {
    const broken = onModelCacheChange(() => {
      throw new Error('a listener failing');
    });
    const listener = vi.fn();
    const stop = onModelCacheChange(listener);
    cacheModel('gemini-flash');
    expect(listener).toHaveBeenCalledTimes(1);
    broken();
    stop();
  });
});
/*
 * A limit's park kept beyond memory (2026-11-24, the CLI and Forma Designer
 * work's wave 3, GAP3-1). The browser hands in no store, so there a limit
 * parks a model in memory exactly as an overload does and nothing else
 * happens; Node hands in a file (src/mcp/modelParks.ts, whose tests hold the
 * file and the threads), stood in for here by a list.
 */
describe("a limit's park, and the store Node keeps it in", () => {
  const KEY = 'stand-in-key-not-a-credential';

  /** A store over a list, as the file keeps it: by tag, read as it stands at `now`. */
  function listStore() {
    const kept: { tag: string; park: ModelPark }[] = [];
    const store: ParkStore = {
      read: (tag, now) => kept.filter((k) => k.tag === tag && k.park.until > now).map((k) => k.park),
      add: (tag, park) => {
        kept.push({ tag, park });
      },
    };
    return { kept, store };
  }

  it('with no store, as in the browser, parks in memory exactly as an overload does, and keeps nothing else', () => {
    noteModelLimited('limited', KEY, 'per-minute', 2_049, T0);
    noteModelOverloaded('busy', T0, 2_049);
    for (const model of ['limited', 'busy']) {
      expect(isModelInCooldown(model, T0 + 2_048)).toBe(true);
      expect(isModelInCooldown(model, T0 + 2_049)).toBe(false);
    }
    noteModelLimited('unstated', KEY, 'unknown', undefined, T0);
    expect(isModelInCooldown('unstated', T0 + OVERLOAD_COOLDOWN_MS - 1)).toBe(true);
    expect(isModelInCooldown('unstated', T0 + OVERLOAD_COOLDOWN_MS)).toBe(false);
    expect(keptParks(KEY, T0)).toEqual([]);
    restoreParks(KEY, T0);
    expect(isModelInCooldown('never-seen', T0)).toBe(false);
  });

  it("keeps each limit's park by the key's tag, never the key, the minute when no wait was said, and lays them in again after the memory is cleared", () => {
    const { kept, store } = listStore();
    keepModelChoiceIn({ session: null, day: null, parks: store });
    try {
      noteModelLimited('spent', ` ${KEY} `, 'daily', 5 * 3_600_000, T0);
      noteModelLimited('unstated', KEY, 'unknown', undefined, T0);
      expect(kept).toEqual([
        { tag: keyTag(KEY), park: { model: 'spent', kind: 'daily', until: T0 + 5 * 3_600_000 } },
        { tag: keyTag(KEY), park: { model: 'unstated', kind: 'unknown', until: T0 + OVERLOAD_COOLDOWN_MS } },
      ]);
      expect(JSON.stringify(kept)).not.toContain(KEY);
      // An overload's park is the last minute's, not the key's: memory alone.
      noteModelOverloaded('busy', T0);
      expect(kept.map((k) => k.park.model)).not.toContain('busy');

      // A 404's re-detect clears the memory; the key's parks come back with the next model resolved for it, another key's do not.
      clearCachedModel();
      expect(isModelInCooldown('spent', T0 + 1_000)).toBe(false);
      restoreParks('another-key', T0 + 1_000);
      expect(isModelInCooldown('spent', T0 + 1_000)).toBe(false);
      restoreParks(KEY, T0 + 1_000);
      expect(isModelInCooldown('spent', T0 + 1_000)).toBe(true);
      expect(startingModel('spent', ['spent', 'unstated', 'free'], T0 + 1_000)).toBe('free');
      expect(isModelInCooldown('spent', T0 + 5 * 3_600_000)).toBe(false);
    } finally {
      keepModelChoiceIn({ session: null, day: null, parks: null });
    }
  });

  it('never shortens a park already in memory, and a store that fails never fails the request: the park stays in memory', () => {
    const { store } = listStore();
    keepModelChoiceIn({ session: null, day: null, parks: store });
    try {
      noteModelOverloaded('model', T0, 120_000);
      store.add(keyTag(KEY), { model: 'model', kind: 'per-minute', until: T0 + 30_000 }, T0);
      restoreParks(KEY, T0);
      expect(isModelInCooldown('model', T0 + 60_000)).toBe(true);
    } finally {
      keepModelChoiceIn({ session: null, day: null, parks: null });
    }
    const broken: ParkStore = {
      read: () => {
        throw new Error('the file cannot be read');
      },
      add: () => {
        throw new Error('the folder cannot be written');
      },
    };
    keepModelChoiceIn({ session: null, day: null, parks: broken });
    try {
      expect(() => noteModelLimited('limited', KEY, 'daily', 60_000, T0)).not.toThrow();
      expect(isModelInCooldown('limited', T0 + 1_000)).toBe(true);
      expect(keptParks(KEY, T0)).toEqual([]);
      expect(() => restoreParks(KEY, T0)).not.toThrow();
    } finally {
      keepModelChoiceIn({ session: null, day: null, parks: null });
    }
  });

  /*
   * The wave's review (W3R-3): the wait geminiService hands in for a day's
   * limit is the browser's count, an hour out on the days the clocks change;
   * a store that knows the reset (Node's, src/mcp/modelParks.ts) decides it,
   * in memory as in the store. A minute's limit keeps the wait Google said.
   */
  it("keeps a day's park until the reset the store names, in memory as in the store, and a minute's for the wait said", () => {
    const { kept, store } = listStore();
    const reset = T0 + 22.5 * 3_600_000;
    keepModelChoiceIn({ session: null, day: null, parks: { ...store, dailyReset: () => reset } });
    try {
      noteModelLimited('spent', KEY, 'daily', 23.5 * 3_600_000, T0);
      noteModelLimited('minute', KEY, 'per-minute', 41_000, T0);
      expect(kept.map((k) => k.park)).toEqual([
        { model: 'spent', kind: 'daily', until: reset },
        { model: 'minute', kind: 'per-minute', until: T0 + 41_000 },
      ]);
      expect(isModelInCooldown('spent', reset - 1)).toBe(true);
      expect(isModelInCooldown('spent', reset)).toBe(false);
    } finally {
      keepModelChoiceIn({ session: null, day: null, parks: null });
    }
    // A reset that cannot be worked out leaves the park as it was handed in, in memory.
    keepModelChoiceIn({ session: null, day: null, parks: { ...store, dailyReset: () => { throw new Error('no time zone data'); } } });
    try {
      noteModelLimited('spent-again', KEY, 'daily', 60_000, T0);
      expect(isModelInCooldown('spent-again', T0 + 59_999)).toBe(true);
      expect(isModelInCooldown('spent-again', T0 + 60_000)).toBe(false);
    } finally {
      keepModelChoiceIn({ session: null, day: null, parks: null });
    }
  });
});
