/**
 * What the box keeps over a reload (2026-11-07, agent audit items 69 and 71):
 * a draft per project, and the queue with the project it belongs to.
 */
import { describe, expect, it } from 'vitest';
import { keepQueue, keptQueueFor, MAX_DRAFTS, movedDraft, NEW_DRAFT, parseDrafts, queuedFiles, withDraft, withoutFiles } from './composerStore';

describe('the drafts, one per project', () => {
  it('reads what was kept, and nothing from a store it cannot read', () => {
    expect(parseDrafts(JSON.stringify({ p1: 'make it bold', p2: '' }))).toEqual({ p1: 'make it bold' });
    expect(parseDrafts('not json')).toEqual({});
    expect(parseDrafts(JSON.stringify(['a']))).toEqual({});
    expect(parseDrafts(null)).toEqual({});
  });

  it("gives an older build's single draft to the project that tab had open, unless that project has its own", () => {
    expect(parseDrafts(null, 'typed before', 'p1')).toEqual({ p1: 'typed before' });
    expect(parseDrafts(null, 'typed before')).toEqual({ [NEW_DRAFT]: 'typed before' });
    expect(parseDrafts(JSON.stringify({ p1: 'newer' }), 'typed before', 'p1')).toEqual({ p1: 'newer' });
  });

  it('keeps one per project, drops an empty one, and keeps the newest when there are too many', () => {
    let drafts = withDraft({}, 'p1', 'one');
    drafts = withDraft(drafts, 'p2', 'two');
    expect(drafts).toEqual({ p1: 'one', p2: 'two' });
    expect(withDraft(drafts, 'p1', '')).toEqual({ p2: 'two' });
    let many = {};
    for (let i = 0; i <= MAX_DRAFTS; i += 1) many = withDraft(many, `p${i}`, `text ${i}`);
    expect(Object.keys(many)).toHaveLength(MAX_DRAFTS);
    expect(many).not.toHaveProperty('p0');
    // Writing an old one again makes it the newest.
    expect(Object.keys(withDraft(many, 'p1', 'again')).at(-1)).toBe('p1');
  });

  it("moves a new report's words to its id at its first save", () => {
    expect(movedDraft({ [NEW_DRAFT]: 'half a thought', p2: 'two' }, NEW_DRAFT, 'p9')).toEqual({ p2: 'two', p9: 'half a thought' });
    const none = { p2: 'two' };
    expect(movedDraft(none, NEW_DRAFT, 'p9')).toBe(none);
  });
});

describe('the queue, with its project', () => {
  const items = [
    { id: 'q1', text: 'make it bold' },
    { id: 'q2', text: 'and this one', images: ['data:image/png;base64,A'], imageMeta: [{ uploadId: 'u1', file: 'a.png' }] },
  ];

  it('comes back for its own project only', () => {
    const raw = keepQueue('p1', items);
    expect(keptQueueFor(raw, 'p1')).toEqual(items);
    expect(keptQueueFor(raw, 'p2')).toEqual([]);
    expect(keptQueueFor('not json', 'p1')).toEqual([]);
    expect(keptQueueFor(JSON.stringify({ project: 'p1', items: [{ id: 3 }, { id: 'ok', text: 'kept' }] }), 'p1')).toEqual([{ id: 'ok', text: 'kept' }]);
  });

  it('keeps its words when its files will not fit, each message that lost them saying so', () => {
    expect(withoutFiles(items)).toEqual([items[0], { id: 'q2', text: 'and this one', dropped: true }]);
  });

  it('counts the files a message carries, a PDF and its text layer once', () => {
    expect(queuedFiles({})).toBe(0);
    expect(queuedFiles({ images: ['a', 'b'], imageMeta: [{ uploadId: 'u1' }, { uploadId: 'u1' }], texts: [{ uploadId: 'u1' }, { uploadId: 'u2' }] })).toBe(2);
    expect(queuedFiles({ images: ['a', 'b'] })).toBe(2);
  });
});
