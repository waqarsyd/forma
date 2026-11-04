import { describe, it, expect } from 'vitest';
import { toPersistable, mergeStoredConfig } from './reportConfigStore';
import { SUPPORTED_UNITS } from './reportGeometry';

const defaults = {
  version: '23.2',
  unit: 'HundredthsOfAnInch',
  pageSize: 'Letter',
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
  it('keeps the version and unit learned from the reports the user brings, and nothing else', () => {
    expect(toPersistable(defaults)).toEqual({ version: '23.2', unit: 'HundredthsOfAnInch' });
  });

  it('never carries the API key, however it is spelled', () => {
    const withKey = { ...defaults, customApiKey: 'AIzaSyREALKEYMATERIAL', modelName: 'gemini-flash-latest', openRouterKey: 'sk-or-secret' };
    const out = toPersistable(withKey) as Record<string, unknown>;

    expect(out.customApiKey).toBeUndefined();
    expect(out.modelName).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('AIza');
    expect(JSON.stringify(out)).not.toContain('sk-or');
  });

  it('drops fields added later until they are allowlisted on purpose', () => {
    // Allowlist, not blocklist: a new secret-bearing field must not ride along
    // just because nobody remembered to exclude it.
    const out = toPersistable({ ...defaults, somethingNew: 'x' } as never) as Record<string, unknown>;
    expect(out.somethingNew).toBeUndefined();
  });

  it('keeps none of what Forma works out per request since 2026-11-04', () => {
    const chosen = { ...defaults, pageSize: 'A4', header: { title: 'x' }, footer: { showPageNumbers: true }, rtl: true, spName: 'dbo.X', ocrLanguages: ['ara'], ocrHandwriting: true };
    expect(Object.keys(toPersistable(chosen as never))).toEqual(['version', 'unit']);
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
    expect(mergeStoredConfig(defaults, JSON.stringify({ version: 20.1 })).version).toBe('23.2');
  });

  it('takes a version only as a major and minor', () => {
    expect(mergeStoredConfig(defaults, JSON.stringify({ version: '20.1.3.0' })).version).toBe('23.2');
    expect(mergeStoredConfig(defaults, JSON.stringify({ version: 'latest' })).version).toBe('23.2');
  });

  it('retires what earlier builds stored and Forma now works out: the paper, header, footer, direction, procedure and OCR choices', () => {
    const old = { pageSize: 'Legal', header: { title: 'Job Card' }, footer: { showPageNumbers: false }, rtl: true, spName: 'dbo.X', ocrLanguages: ['ara'], ocrHandwriting: true, version: '20.1' };
    const merged = mergeStoredConfig(defaults, JSON.stringify(old)) as Record<string, unknown>;
    expect(merged.pageSize).toBe('Letter');
    for (const gone of ['header', 'footer', 'rtl', 'spName', 'ocrLanguages', 'ocrHandwriting']) expect(merged[gone]).toBeUndefined();
    expect(merged.version).toBe('20.1');
  });
});

/**
 * `unit` is not free-text (audit BUG-001).
 *
 * It is a DevExpress enum name that reaches the geometry and is then written
 * verbatim into the generated REPX. Accepting any string meant a stored
 * "Document" -- a real ReportUnit member the geometry table did not carry --
 * converted at 100 units per inch instead of 300: a 3x scale error, every font
 * three times too large, and both the layout JSON and the XML internally
 * consistent while doing it. A stored "pixels" fell back the same way.
 */
describe('mergeStoredConfig — the unit is validated, not just typed', () => {
  const merge = (stored: object) => mergeStoredConfig(defaults, JSON.stringify(stored));

  it('accepts every supported unit, Document included, which is real and used to be silently wrong', () => {
    for (const unit of SUPPORTED_UNITS) expect(merge({ unit }).unit).toBe(unit);
    expect(merge({ unit: 'Document' }).unit).toBe('Document');
  });

  it('drops an unsupported unit rather than converting it wrongly', () => {
    for (const unit of ['Nonsense', 'pixels', 'PIXELS', 'Pixel', ' Pixels ', '../../etc', '']) {
      expect(merge({ unit }).unit).toBe(defaults.unit);
    }
  });

  it('keeps the version when the unit is rejected', () => {
    const merged = merge({ unit: 'Nonsense', version: '20.1' });
    expect(merged.unit).toBe(defaults.unit);
    expect(merged.version).toBe('20.1');
  });
});
