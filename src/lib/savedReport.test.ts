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
 * that explanation says *"Save Project while signed out keeps it on this
 * device"*, pointing the user at the path that threw.
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
