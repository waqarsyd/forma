// @vitest-environment jsdom
// Needs localStorage. Must stay line 1; see vitest.config.ts.
/**
 * A saved project has two shapes, and nothing checked they agree.
 *
 * The same report is stored one way in `localStorage` and another in Firestore:
 * `timestamp` is an ISO string locally and an epoch number in the cloud, and
 * `messages` and `result` are live objects locally and JSON strings in the
 * cloud. `firestore.rules` pins the cloud side to exactly six fields with those
 * types, so the divergence is not accidental — a rules-enforced document cannot
 * hold a nested array, and a React state object should not be re-parsed on
 * every render.
 *
 * The audit (TEST-004) recorded the divergence and marked it Medium confidence,
 * because it had not demonstrated a case where the two disagree. Reading both
 * paths, the conversion is correct: the failure this guards against is not a
 * bug that exists, it is one that a future edit to either side introduces
 * silently. The symptom would not be a crash — it is a saved report that
 * reopens blank or loses its conversation, which looks like data loss to the
 * user and like nothing at all to `tsc`.
 *
 * So: round-trip both directions, and pin the edges that currently work by
 * accident rather than by intent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  toFirestoreDocument,
  fromFirestoreDocument,
  reportDisplayName,
  saveReportsLocally,
  loadReportsLocally,
  sessionSignature,
  projectName,
  arrangeProjects,
  readIdList,
  writeIdList,
  toggleId,
  searchTextOf,
  toIndexDocument,
  fromIndexDocument,
  mergeIndexed,
  SEARCH_TEXT_LIMIT,
  deviceProjectsLine,
  plainFirestoreRefusal,
  type SavedReportLike,
} from './savedReport';

const UID = 'alice-uid';

const report = (over: Partial<SavedReportLike> = {}): SavedReportLike => ({
  id: '1756300000000',
  name: 'Quarterly Invoice',
  timestamp: '2026-08-27T10:00:00.000Z',
  messages: [
    { role: 'user', text: 'Recreate this' },
    { role: 'assistant', text: 'Done.' },
  ],
  result: { title: 'Quarterly Invoice', content: '# Spec', repxContent: '<XtraReportsLayoutSerializer/>' },
  ...over,
});

describe('round trip: local shape -> Firestore -> local shape', () => {
  it('returns an identical report', () => {
    const original = report();
    const restored = fromFirestoreDocument(toFirestoreDocument(original, UID));
    expect(restored).toEqual(original);
  });

  it('survives a report with no result', () => {
    // `JSON.stringify(null)` is the string "null", which is truthy — the read
    // side works only because JSON.parse("null") is null. Pinned so a future
    // `data.result ? … : null` rewrite cannot quietly change it.
    const original = report({ result: null });
    const restored = fromFirestoreDocument(toFirestoreDocument(original, UID));
    expect(restored.result).toBeNull();
    expect(restored).toEqual(original);
  });

  it('survives an empty conversation', () => {
    const original = report({ messages: [] });
    expect(fromFirestoreDocument(toFirestoreDocument(original, UID))).toEqual(original);
  });

  it('preserves unicode in the transcript', () => {
    const original = report({
      messages: [{ role: 'user', text: 'Facturé — 你好 🎉 "quoted" \\ backslash\nnewline' }],
    });
    expect(fromFirestoreDocument(toFirestoreDocument(original, UID))).toEqual(original);
  });

  it('preserves the timestamp exactly, not just approximately', () => {
    const original = report({ timestamp: '2026-08-27T10:00:00.123Z' });
    const restored = fromFirestoreDocument(toFirestoreDocument(original, UID));
    expect(restored.timestamp).toBe('2026-08-27T10:00:00.123Z');
  });
});

describe('toFirestoreDocument — the shape firestore.rules allows', () => {
  const doc = toFirestoreDocument(report(), UID);

  it('writes exactly the six fields the rules permit, and no others', () => {
    // `isValidSavedReport` uses hasOnly + hasAll on this set. A seventh field
    // is rejected at write time by a rule this test cannot see.
    expect(Object.keys(doc).sort()).toEqual(
      ['id', 'messages', 'name', 'result', 'timestamp', 'userId'].sort()
    );
  });

  it('writes the types the rules require', () => {
    expect(typeof doc.id).toBe('string');
    expect(typeof doc.name).toBe('string');
    expect(typeof doc.timestamp).toBe('number');
    expect(typeof doc.messages).toBe('string');
    expect(typeof doc.result).toBe('string');
    expect(typeof doc.userId).toBe('string');
  });

  it('stamps the owner, which the rules check against the caller', () => {
    expect(doc.userId).toBe(UID);
  });

  it('keeps the document id and the id field equal', () => {
    // `create` requires incoming().id == reportId, and `update` pins both.
    expect(doc.id).toBe(report().id);
  });

  it('writes a timestamp inside the range the rules accept', () => {
    expect(doc.timestamp).toBeGreaterThan(0);
    expect(doc.timestamp).toBeLessThan(4102444800000);
  });

  it('keeps the name within the 256-character bound', () => {
    const long = toFirestoreDocument(report({ name: 'x'.repeat(500) }), UID);
    expect(long.name.length).toBeLessThanOrEqual(256);
  });
});

describe('fromFirestoreDocument — a stored document must never break the list', () => {
  /**
   * These run in an `onSnapshot` callback. An exception there is not caught by
   * the try/catch around the subscription, so one bad document would take out
   * the whole projects panel rather than one row.
   */
  it('does not throw on a missing timestamp', () => {
    // `new Date(undefined).toISOString()` throws RangeError.
    const doc = { ...toFirestoreDocument(report(), UID), timestamp: undefined as any };
    expect(() => fromFirestoreDocument(doc)).not.toThrow();
  });

  it('does not throw on an unparseable transcript', () => {
    const doc = { ...toFirestoreDocument(report(), UID), messages: '{not json' };
    expect(() => fromFirestoreDocument(doc)).not.toThrow();
    expect(fromFirestoreDocument(doc).messages).toEqual([]);
  });

  it('does not throw on an unparseable result', () => {
    const doc = { ...toFirestoreDocument(report(), UID), result: '{not json' };
    expect(() => fromFirestoreDocument(doc)).not.toThrow();
    expect(fromFirestoreDocument(doc).result).toBeNull();
  });

  it('treats an absent transcript as an empty one', () => {
    const doc = { ...toFirestoreDocument(report(), UID), messages: '' };
    expect(fromFirestoreDocument(doc).messages).toEqual([]);
  });

  it('drops userId, which is a storage concern and not part of a report', () => {
    expect(fromFirestoreDocument(toFirestoreDocument(report(), UID))).not.toHaveProperty('userId');
  });

  it('always yields a sortable timestamp', () => {
    // The list sorts on `new Date(timestamp).getTime()`; NaN would scramble it.
    for (const ts of [undefined, null, 'nonsense', -1, 0] as any[]) {
      const doc = { ...toFirestoreDocument(report(), UID), timestamp: ts };
      const restored = fromFirestoreDocument(doc);
      expect(Number.isNaN(new Date(restored.timestamp).getTime())).toBe(false);
    }
  });
});

describe('reportDisplayName', () => {
  it('leaves a short name alone', () => {
    expect(reportDisplayName('Quarterly Invoice')).toBe('Quarterly Invoice');
  });

  it('truncates a long one with an ellipsis', () => {
    const out = reportDisplayName('x'.repeat(60));
    expect(out).toBe('x'.repeat(30) + '...');
  });

  it('is identical for both storage paths', () => {
    // The two save branches computed this separately. A report saved signed out
    // and one saved signed in must not end up with different names.
    const raw = 'A very long report title that will certainly be truncated';
    expect(toFirestoreDocument(report({ name: reportDisplayName(raw) }), UID).name)
      .toBe(reportDisplayName(raw));
  });

  it('falls back when there is no name at all', () => {
    expect(reportDisplayName('')).toBe('Untitled Report');
    expect(reportDisplayName('   ')).toBe('Untitled Report');
  });
});

/* The session saves itself when this moves (2026-11-05). */
describe('sessionSignature', () => {
  const messages = [
    { id: '1', text: 'an invoice' },
    { id: '2', text: 'Built it.' },
  ];
  const result = { title: 'Invoice', content: '# Invoice', repxContent: '<XtraReportsLayoutSerializer><Item1 Location="10, 0" /></XtraReportsLayoutSerializer>' };
  const base = sessionSignature(messages, result);

  it('signs the same session the same, a reloaded result with a string timestamp included', () => {
    expect(sessionSignature([...messages], { ...result, timestamp: '2026-11-05T10:00:00Z' } as typeof result)).toBe(base);
  });

  it('moves when a control moves without the REPX changing length', () => {
    expect(sessionSignature(messages, { ...result, repxContent: result.repxContent.replace('10, 0', '20, 0') })).not.toBe(base);
  });

  it('moves for a new message, a rating, a failure and an answered question', () => {
    const changed = [
      sessionSignature([...messages, { id: '3', text: 'bigger title' }], result),
      sessionSignature([messages[0], { ...messages[1], rating: 'good' }], result),
      sessionSignature([{ ...messages[0], error: 'quota' }, messages[1]], result),
      sessionSignature([messages[0], { ...messages[1], clarify: { answered: true } }], result),
      sessionSignature([messages[0], { ...messages[1], clarify: { answered: false } }], result),
      sessionSignature(messages, null),
    ];
    expect(new Set([base, ...changed]).size).toBe(changed.length + 1);
  });
});

/* Pins and the archive, kept on this device (2026-11-05). */
describe('arrangeProjects, readIdList, writeIdList and toggleId', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('shows pinned projects first in their own order, then the rest, and hides the archive until it is opened', () => {
    expect(arrangeProjects(list, ['c'], ['b'], false).map((r) => r.id)).toEqual(['c', 'a', 'd']);
    expect(arrangeProjects(list, ['c'], ['b'], true).map((r) => r.id)).toEqual(['b']);
  });

  it('keeps a list of ids on the device, ignoring what is not a list of strings, and toggles one', () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    writeIdList('pins', ['a', 'a', 'b'], store);
    expect(readIdList('pins', store)).toEqual(['a', 'b']);
    data.set('pins', '{"a":1}');
    expect(readIdList('pins', store)).toEqual([]);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleId(['b'], 'a')).toEqual(['b', 'a']);
  });
});

describe('projectName', () => {
  it('keeps a name once it has one', () => {
    expect(projectName('Q3 invoice', 'Invoice', 'an invoice')).toBe('Q3 invoice');
  });

  it("names an untitled project from the report's title, else the first line said", () => {
    expect(projectName('Untitled Report', 'Sales by region', 'hello')).toBe('Sales by region');
    expect(projectName(undefined, undefined, 'hello there\nand more')).toBe('hello there');
    expect(projectName(undefined, '', '')).toBe('Untitled Report');
  });

  // Agent audit item 95: "hello" no longer names a project holding an invoice.
  it('lets a name taken from the first words give way to the report title, and keeps one the person typed', () => {
    expect(projectName('hello', 'Invoice', 'hello')).toBe('Invoice');
    expect(projectName('hello', undefined, 'hello')).toBe('hello');
    expect(projectName('Hello for Q3', 'Invoice', 'hello')).toBe('Hello for Q3');
  });
});

/**
 * The signed-out save was the only unguarded `localStorage.setItem` in the app.
 *
 * Every other one writes a preference — a panel width, a theme boolean — and
 * every one of them sits in a try/catch. The one that writes a report carrying
 * base64 uploads, the only one that can plausibly exhaust the quota, did not;
 * the *delete* path writing the same key did.
 *
 * Demonstrated before fixing: four reports of 1.2 MB each threw
 * `QuotaExceededError: The 5000000-code unit storage quota has been exceeded`.
 * The call sat inside a `setSavedReports` updater, so the exception escaped
 * into React rather than becoming a message.
 *
 * The cloud path already refuses an oversized project with an explanation — and
 * that explanation says *"Save while signed out keeps it on this device"*,
 * pointing the user at the path that threw.
 */
describe('saveReportsLocally', () => {
  const big = (mb: number): SavedReportLike =>
    report({ messages: [{ role: 'user', images: ['data:image/jpeg;base64,' + 'A'.repeat(mb * 1_000_000)] }] });

  beforeEach(() => localStorage.clear());

  it('writes the reports and says it succeeded', () => {
    const reports = [report()];
    expect(saveReportsLocally(reports)).toEqual({ ok: true });
    expect(JSON.parse(localStorage.getItem('savedReports')!)).toEqual(reports);
  });

  it('reports failure instead of throwing when the quota is exhausted', () => {
    const tooMuch = [big(3), big(3), big(3)];
    expect(() => saveReportsLocally(tooMuch)).not.toThrow();
    expect(saveReportsLocally(tooMuch).ok).toBe(false);
  });

  it('explains what happened in terms the user can act on', () => {
    const outcome = saveReportsLocally([big(3), big(3), big(3)]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toMatch(/space|full|storage/i);
      // It must not claim the project was saved, and it must not be silent.
      expect(outcome.message.trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves whatever was already stored intact when the write fails', () => {
    // Losing the existing projects to a failed save of a new one would turn a
    // "could not save" into actual data loss.
    const existing = [report({ id: 'keep-me' })];
    expect(saveReportsLocally(existing).ok).toBe(true);

    saveReportsLocally([big(3), big(3), big(3), ...existing]);

    expect(JSON.parse(localStorage.getItem('savedReports')!)).toEqual(existing);
  });

  it('survives storage being unavailable entirely', () => {
    // Private mode, or a browser configured to block site data.
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
    try {
      expect(() => saveReportsLocally([report()])).not.toThrow();
      expect(saveReportsLocally([report()]).ok).toBe(false);
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});

/**
 * The read side had no validation at all (audit DATA-002), and one of its three
 * call sites is a useState initialiser -- so a corrupted entry did not cost a
 * panel, it threw during the first render and took the whole application to the
 * error boundary with a message that says nothing about storage.
 */
describe('loadReportsLocally', () => {
  beforeEach(() => localStorage.clear());

  it('returns what was saved', () => {
    const reports = [report(), report({ id: '2' })];
    saveReportsLocally(reports);
    expect(loadReportsLocally()).toEqual(reports);
  });

  it('returns an empty list when nothing is stored', () => {
    expect(loadReportsLocally()).toEqual([]);
  });

  it('does not throw on a corrupted entry -- the app boots either way', () => {
    for (const junk of ['{', 'not json', '[1,2,', '"a string"', '123', 'null', '{}']) {
      localStorage.setItem('savedReports', junk);
      expect(() => loadReportsLocally()).not.toThrow();
      expect(Array.isArray(loadReportsLocally())).toBe(true);
    }
  });

  it('drops individual malformed rows and keeps the rest', () => {
    // Losing one unreadable row beats losing the list.
    const good = report({ id: 'keep' });
    localStorage.setItem('savedReports', JSON.stringify([
      good,
      null,
      'a string',
      { id: 'no-name-or-timestamp' },
      { id: 'bad-date', name: 'x', timestamp: 'not a date' },
      42,
    ]));
    expect(loadReportsLocally()).toEqual([good]);
  });

  it('keeps a report whose transcript is an unfamiliar shape', () => {
    // An older build may have stored something this one does not expect.
    // Refusing to list a project because its messages look odd is worse than
    // showing it -- the user can still open and delete it.
    const odd = { ...report(), messages: 'was a string once', result: 12345 };
    localStorage.setItem('savedReports', JSON.stringify([odd]));
    expect(loadReportsLocally()).toHaveLength(1);
  });

  it('survives storage being blocked outright', () => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new DOMException('denied', 'SecurityError'); };
    try {
      expect(() => loadReportsLocally()).not.toThrow();
      expect(loadReportsLocally()).toEqual([]);
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });

  it('round-trips through the writer', () => {
    const reports = [report({ id: 'a' }), report({ id: 'b' })];
    expect(saveReportsLocally(reports).ok).toBe(true);
    expect(loadReportsLocally()).toEqual(reports);
  });
});

/*
 * The account's index of its projects (2026-11-08, site audit item 63): the
 * list listens to one small entry per project instead of the projects.
 */
describe('the projects index', () => {
  const conversation = [
    { role: 'user', text: 'An invoice with a total per customer' },
    { role: 'model', text: 'Here it is.', clarify: { questions: [{ question: 'Which currency?' }] } },
    { role: 'user', text: 'Euros' },
  ];

  it("searches the person's words and Forma's questions, capped at the rules' limit", () => {
    expect(searchTextOf(conversation)).toBe('An invoice with a total per customer\nWhich currency?\nEuros');
    expect(searchTextOf([{ role: 'user', text: 'x'.repeat(SEARCH_TEXT_LIMIT + 50) }])).toHaveLength(SEARCH_TEXT_LIMIT);
    expect(searchTextOf([null, 3, { role: 'user' }])).toBe('');
  });

  it("writes an entry from a saved project with the project's own name and time, and the count of its messages", () => {
    const saved = report({ messages: conversation as never[] });
    const entry = toIndexDocument(saved, UID);
    expect(entry).toEqual({
      id: saved.id,
      name: toFirestoreDocument(saved, UID).name,
      timestamp: new Date(saved.timestamp).getTime(),
      search: searchTextOf(conversation),
      notes: 3,
      userId: UID,
    });
  });

  it('lists an entry with no content, and never throws on a bad one', () => {
    const listed = fromIndexDocument({ id: 'p1', name: 'Invoice', timestamp: 1_790_000_000_000, search: 'euros', notes: 4 });
    expect(listed).toMatchObject({ id: 'p1', name: 'Invoice', messages: [], result: null, stub: true, search: 'euros', notes: 4 });
    expect(() => fromIndexDocument({ timestamp: Number.NaN, notes: -2 } as never)).not.toThrow();
    expect(fromIndexDocument({ notes: -2 } as never).notes).toBe(0);
    // An entry rewritten from a listed one keeps its words and its count.
    expect(toIndexDocument(listed, UID)).toMatchObject({ search: 'euros', notes: 4 });
  });

  it("keeps a project's content where the same save is already here, newest first", () => {
    const full = report({ id: 'a', timestamp: '2026-11-01T00:00:00.000Z', messages: conversation as never[] });
    const rows = [
      fromIndexDocument({ id: 'a', name: 'Renamed', timestamp: Date.parse('2026-11-01T00:00:00.000Z') }),
      fromIndexDocument({ id: 'b', name: 'Newer', timestamp: Date.parse('2026-11-05T00:00:00.000Z') }),
    ];
    const merged = mergeIndexed(rows, [full]);
    expect(merged.map((r) => r.id)).toEqual(['b', 'a']);
    expect(merged[1]).toMatchObject({ name: 'Renamed', messages: conversation });
    expect(merged[1].stub).toBeUndefined();
    // A newer save than the one held: the entry, until it is opened again.
    const later = fromIndexDocument({ id: 'a', name: 'A', timestamp: Date.parse('2026-11-07T00:00:00.000Z') });
    expect(mergeIndexed([later], [full])[0].stub).toBe(true);
  });
});

/*
 * The projects made here before signing in (2026-11-11, the full audit's
 * SA-04): the list showed the account alone, so the work looked lost. Adding
 * them is projectExport.test.ts's.
 */
describe('deviceProjectsLine', () => {
  it('says how many are kept in this browser and not in the account', () => {
    expect(deviceProjectsLine(3)).toBe('3 projects are saved in this browser, not in your account.');
    expect(deviceProjectsLine(1)).toBe('1 project is saved in this browser, not in your account.');
  });
});

/* A refusal the person can act on (2026-11-11, the full audit's SA-21). */
describe('plainFirestoreRefusal', () => {
  it("says the day's allowance is used up, and that a refused sign-in needs refreshing", () => {
    expect(plainFirestoreRefusal({ code: 'resource-exhausted' }, { saving: true })).toMatch(/^Forma's free database allowance for today is used up\. Your project is still open here/);
    expect(plainFirestoreRefusal({ code: 'resource-exhausted' }, { saving: true })).toMatch(/midnight Pacific/);
    expect(plainFirestoreRefusal({ code: 'permission-denied' })).toBe('Your sign-in needs refreshing; sign out and in again.');
  });

  // The SA-21 review: a failed list, open, rename, delete or share was told its project saves.
  it('promises a save with the next change only to the save itself', () => {
    const other = plainFirestoreRefusal({ code: 'resource-exhausted' });
    expect(other).toBe("Forma's free database allowance for today is used up; try again after midnight Pacific time.");
    expect(other).not.toMatch(/saves/);
  });

  it("leaves any other failure to the caller's own sentence", () => {
    expect(plainFirestoreRefusal({ code: 'unavailable' })).toBeNull();
    expect(plainFirestoreRefusal(new Error('x'))).toBeNull();
    expect(plainFirestoreRefusal(null)).toBeNull();
  });
});