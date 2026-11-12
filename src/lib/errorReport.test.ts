/**
 * Error reports (2026-11-12, Owner decision 10, the full audit's SA-15):
 * what a message keeps once scrubbed, what is noise, the code and version a
 * report carries, the switch kept per account, and a reporter that sends each
 * error once, a few a page, spaced as the rules require. What the rules take
 * is proved in tests/firestore.rules.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  areaKey,
  createErrorReporter,
  ERROR_AREAS,
  ERROR_SPACING_MS,
  errorCode,
  errorReportId,
  errorReportOf,
  isNoise,
  MAX_MESSAGE,
  readErrorReporting,
  refreshErrorReports,
  scrubMessage,
  startErrorReports,
  versionTag,
  writeErrorReporting,
  type ErrorReport,
} from './errorReport';
import { hasErrorSink, setErrorSink } from './errorSink';

const memory = () => {
  const kept = new Map<string, string>();
  return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
};

afterEach(() => setErrorSink(null, null));

describe('scrubMessage', () => {
  it('takes out keys, addresses, links beyond their site, paths, file names, quoted text, long numbers and ids', () => {
    const key = `AIza${'a1B2c3D4e5'.repeat(3)}abcde`;
    expect(scrubMessage(`Request failed with ${key}`)).toBe('Request failed with (a key)');
    expect(scrubMessage('Could not share with jane.doe@example.com')).toBe('Could not share with (an address)');
    expect(scrubMessage('GET https://firestore.googleapis.com/v1/projects/p/databases/x?key=secret failed')).toBe('GET https://firestore.googleapis.com/… failed');
    expect(scrubMessage('Loading https://openforma.web.app failed')).toBe('Loading https://openforma.web.app failed');
    expect(scrubMessage('No document to update: projects/forma/databases/(default)/documents/users/x/reports/y')).toBe('No document to update: (a path)');
    expect(scrubMessage('ENOENT C:\\Users\\jane\\Desktop\\pay.pdf')).toBe('ENOENT (a path)');
    expect(scrubMessage('Could not read Payroll_March.xlsx')).toBe('Could not read (a file)');
    expect(scrubMessage('Unexpected token \'I\', "Invoice for Acme Ltd" is not valid JSON')).toBe("Unexpected token 'I', (text) is not valid JSON");
    expect(scrubMessage("Cannot read properties of undefined (reading 'repxContent')")).toBe("Cannot read properties of undefined (reading 'repxContent')");
    expect(scrubMessage("Field 'Customer Name of the account holder' is missing")).toBe('Field (text) is missing');
    expect(scrubMessage('Account 4111 1111 1111 1111 declined, call +91 98765-43210')).toBe('Account (a number) declined, call +(a number)');
    expect(scrubMessage('Missing user Xk3p9QmZ2rT8wLs5vN1yHb0c')).toBe('Missing user (an id)');
  });

  it('keeps what the code says, on one line, and cuts it to 200 characters', () => {
    expect(scrubMessage('Maximum update depth exceeded.\n  at Preview')).toBe('Maximum update depth exceeded. at Preview');
    expect(scrubMessage('permission-denied: Missing or insufficient permissions.')).toBe('permission-denied: Missing or insufficient permissions.');
    const long = scrubMessage('word '.repeat(100));
    expect(long.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(long.endsWith('…')).toBe(true);
    // Never cut inside a character, whatever it is counted in.
    const wide = scrubMessage('😀'.repeat(150));
    expect(wide.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(wide).not.toMatch(/[\uD800-\uDBFF]…$/);
  });
});

describe('what a report is made of', () => {
  it('files each error boundary under its area, and anything else under other', () => {
    expect(areaKey('Forma')).toBe('page');
    expect(areaKey('the Preview')).toBe('preview');
    expect(areaKey('the REPX view')).toBe('repx');
    expect(areaKey('the conversation')).toBe('conversation');
    expect(areaKey('uncaught')).toBe('uncaught');
    expect(areaKey('the sidebar')).toBe('other');
  });

  it('names the code a report carries: a code the rules take, else the name, else Error', () => {
    expect(errorCode({ code: 'permission-denied', name: 'FirebaseError' })).toBe('permission-denied');
    expect(errorCode({ code: 'forma/report-limit' })).toBe('forma/report-limit');
    expect(errorCode(new TypeError('x'))).toBe('TypeError');
    expect(errorCode({ code: 'has spaces in it', name: 'RangeError' })).toBe('RangeError');
    expect(errorCode('a string')).toBe('Error');
  });

  it('names the release and the commit, or dev', () => {
    expect(versionTag({ version: '1.6.0', commit: '558d18e0123456789abcdef0123456789abcdef0', date: '2026-11-12' })).toBe('1.6.0+558d18e');
    expect(versionTag({ commit: 'unknown', date: '' })).toBe('dev');
    expect(versionTag(null)).toBe('dev');
  });

  it('makes ids the rules take', () => {
    expect(errorReportId()).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it('leaves out noise: aborts, stale chunks, extensions, cross-origin scripts, lost connections, rejections that are not errors', () => {
    expect(isNoise('preview', Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))).toBe(true);
    expect(isNoise('page', new TypeError('Failed to fetch dynamically imported module: https://x/assets/App-1.js'))).toBe(true);
    expect(isNoise('uncaught', new Error('ResizeObserver loop completed with undelivered notifications.'))).toBe(true);
    expect(isNoise('uncaught', Object.assign(new Error('boom'), { stack: 'Error: boom\n    at chrome-extension://abc/content.js:1:1' }))).toBe(true);
    expect(isNoise('uncaught', null)).toBe(true);
    expect(isNoise('rejection', 'just a string')).toBe(true);
    expect(isNoise('rejection', new TypeError('Failed to fetch'))).toBe(true);
    expect(isNoise('rejection', Object.assign(new Error('offline'), { code: 'unavailable' }))).toBe(true);
    // Inside an area, a failure to reach the network is that area's to report.
    expect(isNoise('preview', new TypeError('Failed to fetch'))).toBe(false);
    expect(isNoise('rejection', new RangeError('Invalid array length'))).toBe(false);
  });

  it('builds the five fields and nothing that names the person', () => {
    const report = errorReportOf('the Preview', new TypeError('Cannot draw jane@example.com’s page'), new Date('2026-11-12T10:00:00Z'), { version: '1.6.0', commit: 'abcdef0', date: '2026-11-12' })!;
    expect(Object.keys(report).sort()).toEqual(['area', 'code', 'day', 'id', 'message', 'version']);
    expect(report).toMatchObject({ day: '2026-11-12', version: '1.6.0+abcdef0', area: 'preview', code: 'TypeError' });
    expect(report.message).not.toContain('jane');
    expect(errorReportOf('uncaught', null)).toBeNull();
  });

  it('files under areas the rules list, in the same order', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toContain(`data.area in [${ERROR_AREAS.map((a) => `'${a}'`).join(', ')}]`);
    expect(rules).toContain(`data.message.size() <= ${MAX_MESSAGE}`);
    expect(rules).toContain(`duration.value(${ERROR_SPACING_MS / 1000}, 's')`);
  });
});

describe('createErrorReporter', () => {
  it('sends each error once a page, a few a page, spaced as the rules require', async () => {
    const sent: ErrorReport[] = [];
    let clock = 1_000_000;
    const waits: number[] = [];
    const report = createErrorReporter(
      async (r) => {
        sent.push(r);
      },
      { maxPerPage: 3, now: () => clock, wait: async (ms) => { waits.push(ms); clock += ms; } },
    );
    const broken = new TypeError('Cannot read properties of null');
    for (let i = 0; i < 5; i++) report('the Preview', broken);
    report('the spec', new RangeError('Invalid array length'));
    report('the mockup', new Error('one'));
    report('the mockup', new Error('two'));
    report('uncaught', null);
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent.map((r) => r.area)).toEqual(['preview', 'spec', 'mockup']);
    expect(waits).toEqual([ERROR_SPACING_MS, ERROR_SPACING_MS]);
  });

  it('drops a send that fails rather than trying again', async () => {
    const send = vi.fn().mockRejectedValue(new Error('refused'));
    const report = createErrorReporter(send, { wait: async () => undefined });
    report('the spec', new Error('a'));
    report('the spec', new Error('b'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });
});

describe('the switch', () => {
  it('is off by default, and one account\'s "on" is not another\'s', () => {
    const storage = memory();
    expect(readErrorReporting('alice', storage)).toBe(false);
    storage.setItem('forma:errorReports', JSON.stringify({ uid: 'alice', on: true }));
    expect(readErrorReporting('alice', storage)).toBe(true);
    expect(readErrorReporting('bob', storage)).toBe(false);
    expect(readErrorReporting(null, storage)).toBe(false);
    storage.setItem('forma:errorReports', 'not json');
    expect(readErrorReporting('alice', storage)).toBe(false);
  });

  it('writes the account it belongs to', () => {
    const storage = memory();
    writeErrorReporting('alice', true, storage);
    expect(JSON.parse(storage.getItem('forma:errorReports')!)).toEqual({ uid: 'alice', on: true });
  });

  it('sets no sink without an account, or with the switch off', () => {
    // Node has no localStorage, so the switch reads as off here.
    startErrorReports({ uid: 'alice', send: async () => undefined });
    expect(hasErrorSink()).toBe(false);
    startErrorReports(null);
    refreshErrorReports();
    expect(hasErrorSink()).toBe(false);
  });
});
