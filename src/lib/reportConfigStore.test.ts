import { describe, it, expect } from 'vitest';
import { toPersistable, mergeStoredConfig } from './reportConfigStore';
import { SUPPORTED_UNITS, SUPPORTED_PAGE_SIZES } from './reportGeometry';

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

/**
 * `unit` and `pageSize` are not free-text (audit BUG-001).
 *
 * They are DevExpress enum names that reach the geometry and are then written
 * verbatim into the generated REPX. Accepting any string meant a stored
 * "Document" -- a real ReportUnit member the geometry table did not carry --
 * converted at 100 units per inch instead of 300: a 3x scale error, every font
 * three times too large, and both the layout JSON and the XML internally
 * consistent while doing it. A stored "a4" or "pixels" fell back the same way.
 *
 * Type-checking was not enough, so the domain is checked too. An unsupported
 * value is dropped for the default rather than throwing, matching how the rest
 * of this function treats a corrupted entry.
 */
describe('mergeStoredConfig — unit and pageSize are validated, not just typed', () => {
  const defaults = { version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter' };
  const merge = (stored: object) => mergeStoredConfig(defaults, JSON.stringify(stored));

  it('accepts every supported value', () => {
    for (const unit of SUPPORTED_UNITS) expect(merge({ unit }).unit).toBe(unit);
    for (const pageSize of SUPPORTED_PAGE_SIZES) expect(merge({ pageSize }).pageSize).toBe(pageSize);
  });

  it('accepts Document and Tabloid, which are real and used to be silently wrong', () => {
    expect(merge({ unit: 'Document' }).unit).toBe('Document');
    expect(merge({ pageSize: 'Tabloid' }).pageSize).toBe('Tabloid');
  });

  it('drops an unsupported unit rather than converting it wrongly', () => {
    for (const unit of ['Nonsense', 'pixels', 'PIXELS', 'Pixel', ' Pixels ', '../../etc', '']) {
      expect(merge({ unit }).unit).toBe(defaults.unit);
    }
  });

  it('drops an unsupported page size', () => {
    for (const pageSize of ['A3', 'a4', 'LETTER', 'Letter ', '']) {
      expect(merge({ pageSize }).pageSize).toBe(defaults.pageSize);
    }
  });

  it('keeps the other fields when one is rejected', () => {
    // A bad unit must not cost the user their version or paper choice.
    const merged = merge({ unit: 'Nonsense', pageSize: 'A4', version: '20.1' });
    expect(merged.unit).toBe(defaults.unit);
    expect(merged.pageSize).toBe('A4');
    expect(merged.version).toBe('20.1');
  });

  it('still does not validate the fields that are genuinely free-text', () => {
    // `version` is checked against the dropdown elsewhere; header/footer text is
    // the user's own words. Validation here is specifically about the two enum
    // fields that reach the XML.
    expect(mergeStoredConfig({ ...defaults, header: { title: '' } } as any,
      JSON.stringify({ header: { title: 'Anything at all — 你好' } }) as any) as any)
      .toMatchObject({ header: { title: 'Anything at all — 你好' } });
  });
});