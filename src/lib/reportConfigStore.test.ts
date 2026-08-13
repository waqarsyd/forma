import { describe, it, expect } from 'vitest';
import { toPersistable, mergeStoredConfig } from './reportConfigStore';

const defaults = {
  version: '23.2',
  unit: 'HundredthsOfAnInch',
  pageSize: 'Letter',
  header: { showCompanyLogo: false, title: '' },
  footer: { showPageNumbers: true, customText: '' },
  customApiKey: '',
};

/**
 * The invariant that matters here fails silently in the worst way: a key written
 * to localStorage looks like nothing at all until someone opens devtools, and by
 * then it is on disk and in every backup of that profile. The version-persisting
 * half fails quietly too — the setting appears to work, resets on reload, and
 * the next export goes out targeting the wrong DevExpress.
 */
describe('toPersistable', () => {
  it('keeps the report fields', () => {
    expect(toPersistable(defaults)).toEqual({
      version: '23.2',
      unit: 'HundredthsOfAnInch',
      pageSize: 'Letter',
      header: { showCompanyLogo: false, title: '' },
      footer: { showPageNumbers: true, customText: '' },
    });
  });

  it('never carries the API key, however it is spelled', () => {
    const withKey = { ...defaults, customApiKey: 'AIzaSyREALKEYMATERIAL', modelName: 'gemini-flash-latest' };
    const out = toPersistable(withKey) as Record<string, unknown>;

    expect(out.customApiKey).toBeUndefined();
    expect(out.modelName).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('AIza');
  });

  it('drops fields added later until they are allowlisted on purpose', () => {
    // Allowlist, not blocklist: a new secret-bearing field must not ride along
    // just because nobody remembered to exclude it.
    const out = toPersistable({ ...defaults, somethingNew: 'x' } as never) as Record<string, unknown>;
    expect(out.somethingNew).toBeUndefined();
  });
});

describe('mergeStoredConfig', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(mergeStoredConfig(defaults, null)).toEqual(defaults);
  });

  it('restores a stored version over the default', () => {
    const merged = mergeStoredConfig(defaults, JSON.stringify({ version: '20.1' }));
    expect(merged.version).toBe('20.1');
    expect(merged.unit).toBe('HundredthsOfAnInch');
  });

  it('refuses to read a key back out of storage', () => {
    // Whether it got there by a future bug or by hand, it is not config.
    const merged = mergeStoredConfig(defaults, JSON.stringify({ version: '20.1', customApiKey: 'AIzaLEAKED' }));
    expect(merged.customApiKey).toBe('');
  });

  it('falls back to the defaults on malformed JSON rather than throwing', () => {
    expect(mergeStoredConfig(defaults, '{not json')).toEqual(defaults);
    expect(mergeStoredConfig(defaults, '[]')).toEqual(defaults);
    expect(mergeStoredConfig(defaults, 'null')).toEqual(defaults);
  });

  it('ignores fields of the wrong type instead of adopting them', () => {
    const merged = mergeStoredConfig(defaults, JSON.stringify({ version: 20.1, pageSize: ['A4'] }));
    expect(merged.version).toBe('23.2');
    expect(merged.pageSize).toBe('Letter');
  });

  it('merges a partial header over the default rather than replacing it', () => {
    const merged = mergeStoredConfig(defaults, JSON.stringify({ header: { title: 'Job Card' } }));
    expect(merged.header).toEqual({ showCompanyLogo: false, title: 'Job Card' });
  });
});
