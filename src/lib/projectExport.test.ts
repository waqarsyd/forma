/**
 * Every saved project in one .zip, items 59 and 66 (2026-11-08, the site audit's batch SI),
 * and since 2026-11-11 everything else the account holds (the full audit's SA-10).
 */
import { describe, expect, it, vi } from 'vitest';
import { copyProjectsToAccount, deviceCopyLine, exportFileName, projectExportEntries, readAccountExtras, type AccountReader } from './projectExport';

describe('projectExportEntries', () => {
  it('writes each project as JSON, its .repx beside it when it has one, and a README', () => {
    const at = new Date('2026-11-08T10:00:00Z');
    const entries = projectExportEntries(
      [
        { id: '1', name: 'Invoice', timestamp: '2026-11-07T00:00:00.000Z', messages: [{ role: 'user', text: 'hi' }], result: { repxContent: '<x/>' } },
        { id: '2', name: '', timestamp: '2026-11-06T00:00:00.000Z', messages: [], result: null },
      ],
      at,
    );
    expect(entries.map((e) => e.name)).toEqual(['README.txt', 'Invoice.json', 'Invoice.repx', 'Untitled report.json']);
    expect(JSON.parse(entries[1].content as string)).toMatchObject({ id: '1', name: 'Invoice', messages: [{ role: 'user', text: 'hi' }] });
    expect(entries[2].content).toBe('<x/>');
    expect(entries[0].content).toContain('2 projects');
    // Only what the archive holds is listed.
    expect(entries[0].content).not.toContain('learning.jsonl');
    expect(exportFileName(at)).toBe('forma-projects-2026-11-08.zip');
  });

  it('keeps two projects of one name apart, and makes a name with a slash safe, since the archive keeps its folders', () => {
    const names = projectExportEntries([
      { id: '1', name: 'Q1/Q2', timestamp: '2026-11-07T00:00:00.000Z', messages: [], result: null },
      { id: '2', name: 'Invoice', timestamp: '2026-11-07T00:00:00.000Z', messages: [], result: null },
      { id: '3', name: 'Invoice', timestamp: '2026-11-07T00:00:00.000Z', messages: [], result: null },
      { id: '4', name: 'v1.2 notes', timestamp: '2026-11-07T00:00:00.000Z', messages: [], result: null },
      { id: '5', name: 'v1.2 notes', timestamp: '2026-11-07T00:00:00.000Z', messages: [], result: null },
      { id: '6', name: 'shares', timestamp: '2026-11-07T00:00:00.000Z', messages: [], result: null },
    ]).map((e) => e.name);
    expect(names).toEqual(['README.txt', 'Q1-Q2.json', 'Invoice.json', 'Invoice (2).json', 'v1.2 notes.json', 'v1.2 notes (2).json', 'shares (2).json']);
  });

  it("adds each project's versions, what Forma learned, the shares with their invitees and the memory, and lists them in the README", () => {
    const entries = projectExportEntries(
      [{ id: 'p1', name: 'Invoice', timestamp: '2026-11-07T00:00:00.000Z', messages: [], result: null }],
      new Date('2026-11-11T10:00:00Z'),
      {
        revisions: {
          p1: [
            { label: 'Bigger title', timestamp: Date.parse('2026-11-07T10:15:00Z'), snapshot: { result: { title: 'Invoice' } } },
            { label: 'Bigger title', timestamp: Date.parse('2026-11-07T10:15:00Z'), snapshot: { result: null } },
          ],
        },
        learning: [{ id: 'e1', kind: 'kept' }, { id: 'e2', kind: 'thumbs' }],
        shares: [{ id: 's1', reportId: 'p1', name: 'Invoice', access: 'restricted', timestamp: Date.parse('2026-11-08T00:00:00Z'), invited: ['bob@example.com'] }],
        memory: { memories: [{ text: 'Always use A4' }], kept: [], learnFromKept: true },
      },
    );
    const byName = new Map(entries.map((e) => [e.name, e.content as string]));
    expect([...byName.keys()]).toEqual([
      'README.txt',
      'Invoice.json',
      'revisions/Invoice/2026-11-07 10.15 Bigger title.json',
      'revisions/Invoice/2026-11-07 10.15 Bigger title (2).json',
      'learning.jsonl',
      'shares.json',
      'memory.json',
    ]);
    expect(JSON.parse(byName.get('revisions/Invoice/2026-11-07 10.15 Bigger title.json')!)).toMatchObject({ label: 'Bigger title', version: { result: { title: 'Invoice' } } });
    expect(byName.get('learning.jsonl')!.trim().split('\n').map((line) => JSON.parse(line).id)).toEqual(['e1', 'e2']);
    expect(JSON.parse(byName.get('shares.json')!)).toEqual([
      { id: 's1', project: 'p1', name: 'Invoice', access: 'restricted', sharedAt: '2026-11-08T00:00:00.000Z', link: 'https://openforma.web.app/s/s1', invited: ['bob@example.com'] },
    ]);
    expect(JSON.parse(byName.get('memory.json')!).memories[0].text).toBe('Always use A4');
    const readme = byName.get('README.txt')!;
    for (const part of ['revisions/', 'learning.jsonl', 'shares.json', 'memory.json']) expect(readme).toContain(part);
  });
});

/*
 * The projects made in this browser before signing in, added to the account
 * when asked (2026-11-11, the full audit's SA-04): the list showed the account
 * alone, so the work looked lost.
 */
describe('copyProjectsToAccount', () => {
  const project = (id: string, timestamp: string) => ({ id, name: id, timestamp, messages: [], result: null });
  const local = [
    project('a', '2026-11-10T10:00:00.000Z'),
    project('b', '2026-11-10T11:00:00.000Z'),
    project('c', '2026-11-10T12:00:00.000Z'),
    project('d', '2026-11-10T13:00:00.000Z'),
    project('e', '2026-11-10T14:00:00.000Z'),
  ];
  // c was saved in the account after signing in (newer there); d's account copy is older.
  const inAccount = new Map([
    ['c', '2026-11-11T09:00:00.000Z'],
    ['d', '2026-11-09T09:00:00.000Z'],
  ]);

  it('writes each one, keeps here what could not go, and does not write over a newer save of the same project', async () => {
    const written: string[] = [];
    const outcome = await copyProjectsToAccount(local, inAccount, async (r) => {
      if (r.id === 'e') throw new Error('offline');
      if (r.id === 'b') return false;
      written.push(r.id);
      return true;
    });
    expect(written).toEqual(['a', 'd']);
    expect(outcome.copied.map((r) => r.id)).toEqual(['a', 'c', 'd']);
    expect(outcome.left.map((r) => r.id)).toEqual(['b', 'e']);
  });

  it('says what became of them in plain words', () => {
    expect(deviceCopyLine(3, 0)).toBe('Added 3 projects to your account.');
    expect(deviceCopyLine(1, 1)).toBe('Added 1 project to your account. 1 could not be added and stays in this browser.');
    expect(deviceCopyLine(0, 2)).toBe('2 could not be added and stay in this browser.');
  });
});

describe('readAccountExtras', () => {
  it("reads each project's versions newest first, the learning events and the shares with their invitees", async () => {
    const docs = (rows: unknown[]) => ({ docs: rows.map((row) => ({ data: () => row })) });
    const asked: string[] = [];
    const client = {
      db: {},
      sdk: {
        orderBy: (field: string, way: string) => `${field} ${way}`,
        query: (ref: string, order: string) => `${ref} by ${order}`,
        getDocs: async (ref: string) => {
          asked.push(ref);
          if (ref === 'versions/p1 by timestamp desc') return docs([{ label: 'Bigger title', timestamp: 2, snapshot: '{"result":null}' }, { label: 'Broken', timestamp: 1, snapshot: '{not json' }]);
          if (ref === 'learning') return docs([{ id: 'e1' }]);
          if (ref === 'owned') return docs([{ id: 's1', reportId: 'p1', name: 'Invoice', access: 'restricted', timestamp: 3 }, { id: 's2', reportId: 'p1', name: 'Invoice', access: 'link', timestamp: 4 }]);
          return docs([]);
        },
      },
      paths: {
        versionsCollectionRef: (_db: unknown, _uid: string, id: string) => `versions/${id}`,
        learningCollectionRef: () => 'learning',
        ownedShares: () => 'owned',
        readShareEmails: async (_db: unknown, share: { id: string }) => {
          if (share.id === 's2') throw new Error('refused');
          return ['bob@example.com'];
        },
      },
    } as unknown as AccountReader;
    const extras = await readAccountExtras(client, 'alice', ['p1']);
    expect(asked).toContain('versions/p1 by timestamp desc');
    expect(extras.revisions).toEqual({
      p1: [
        { label: 'Bigger title', timestamp: 2, snapshot: { result: null } },
        { label: 'Broken', timestamp: 1, snapshot: '{not json' },
      ],
    });
    expect(extras.learning).toEqual([{ id: 'e1' }]);
    expect(extras.shares).toEqual([
      { id: 's1', reportId: 'p1', name: 'Invoice', access: 'restricted', timestamp: 3, invited: ['bob@example.com'] },
      { id: 's2', reportId: 'p1', name: 'Invoice', access: 'link', timestamp: 4, invited: [] },
    ]);
    expect(extras.unread).toBeUndefined();
  });

  // The SA-10 review (2026-11-11): one refused read cost the whole archive.
  it('leaves out a part it cannot read, and names it in the README, rather than failing the download', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = {
      db: {},
      sdk: {
        orderBy: () => '',
        query: (ref: string) => ref,
        getDocs: async (ref: string) => {
          if (ref === 'versions/p2' || ref === 'learning') throw new Error('refused');
          return { docs: [] };
        },
      },
      paths: {
        versionsCollectionRef: (_db: unknown, _uid: string, id: string) => `versions/${id}`,
        learningCollectionRef: () => 'learning',
        ownedShares: () => 'owned',
        readShareEmails: async () => [],
      },
    } as unknown as AccountReader;
    const extras = await readAccountExtras(client, 'alice', ['p1', 'p2']);
    expect(extras.revisions).toEqual({ p1: [] });
    expect(extras.learning).toBeUndefined();
    expect(extras.shares).toEqual([]);
    expect(extras.unread).toEqual(['the earlier versions of 1 project', 'what Forma learned from your use']);
    const readme = projectExportEntries([{ id: 'p1', name: 'A', timestamp: '2026-11-11T00:00:00.000Z', messages: [], result: null }], new Date(0), extras)[0].content;
    expect(readme).toContain('Not in this archive, because it could not be read just now');
    expect(readme).toContain('  what Forma learned from your use');
    warn.mockRestore();
  });
});
