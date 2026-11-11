/**
 * The "Safe for spreadsheets" choice (SE-18) and where it is kept. Under Node
 * there is no localStorage, so each case puts in the storage it needs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { csvSafetyPreferred, preferCsvSafety, resetCsvSafety } from './csvSafety';

/** A storage that holds what it is given, or refuses to write, read, or both. */
function storage(refuse: { read?: boolean; write?: boolean } = {}) {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => {
      if (refuse.read) throw new Error('SecurityError');
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (refuse.write) throw new Error('QuotaExceededError');
      items.set(key, value);
    },
    removeItem: (key: string) => {
      if (refuse.write) throw new Error('SecurityError');
      items.delete(key);
    },
  };
}

const use = (s: ReturnType<typeof storage> | undefined) => Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });

afterEach(() => {
  resetCsvSafety();
  use(undefined);
});

describe('csvSafety', () => {
  it('is off until asked for, and kept in this browser once it is', () => {
    const kept = storage();
    use(kept);
    expect(csvSafetyPreferred()).toBe(false);
    preferCsvSafety(true);
    expect(kept.items.get('forma.csvSafeForSpreadsheets')).toBe('1');
    // A new page reads it back from the browser.
    resetCsvSafety();
    expect(csvSafetyPreferred()).toBe(true);
    preferCsvSafety(false);
    expect(kept.items.has('forma.csvSafeForSpreadsheets')).toBe(false);
    expect(csvSafetyPreferred()).toBe(false);
  });

  /** The re-audit's R3-09: the switch showed on and every CSV was written without it. */
  it('holds for this visit where the browser refuses to keep it', () => {
    use(storage({ read: true, write: true }));
    expect(csvSafetyPreferred()).toBe(false);
    preferCsvSafety(true);
    expect(csvSafetyPreferred()).toBe(true);
    preferCsvSafety(false);
    expect(csvSafetyPreferred()).toBe(false);
  });

  it('answers what was chosen here when storage reads but will not write', () => {
    const kept = storage({ write: true });
    kept.items.set('forma.csvSafeForSpreadsheets', '1');
    use(kept);
    expect(csvSafetyPreferred()).toBe(true);
    preferCsvSafety(false);
    // Storage still says on, and could not be told otherwise: this page's choice stands.
    expect(kept.items.get('forma.csvSafeForSpreadsheets')).toBe('1');
    expect(csvSafetyPreferred()).toBe(false);
  });
});
