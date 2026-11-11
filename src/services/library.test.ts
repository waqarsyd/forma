/**
 * The ordering rule is what this file exists to pin: **the import saves before it
 * embeds.** Saving afterwards would mean a network failure threw away chunking
 * already done locally, and the retry would re-hash and re-request everything.
 * Nothing else in the codebase can catch that inversion — it is invisible until
 * someone's import fails halfway and their library comes back empty.
 *
 * The retrieval cases are all about answering `''` honestly. An empty block is the
 * ordinary case, and every early return has to be a real "nothing to add" rather
 * than a swallowed failure.
 *
 * As elsewhere in this suite the loops sit inside a single case, so the grep and the
 * run agree.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  importReports,
  forgetKept,
  keepReport,
  listSources,
  MAX_KEPT_REPORTS,
  nearestKept,
  retrieveHouseStyle,
  sources,
  removeSource,
  type KeptReport,
  type LibraryDeps,
} from './library';
import type { LibraryEntry, LibraryStorage } from '../lib/embedStore';
import type { KeptRecord, KeptStorage } from '../lib/libraryDb';

const report = (controls: string, bandHeight = '96') =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<XtraReportsLayoutSerializer Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R"><Bands>' +
  `<Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="${bandHeight}"><Controls>${controls}</Controls></Item1>` +
  '</Bands></XtraReportsLayoutSerializer>';

/**
 * Distinguished by FONT, not by name or text.
 *
 * `repxChunks` redacts `Name` and `Text`, so two labels differing only in those
 * are literally the same fragment and the library holds one — which is the
 * deliberate "a footer copied across thirty reports is one example" behaviour.
 * A fixture that varied the name would be testing that property by accident
 * while appearing to test something else.
 */
const label = (font: string) => `<Item1 Ref="2" ControlType="XRLabel" Name="lbl" Text="Total" Font="${font}" />`;

/** An in-memory store that records the order of writes. */
function fakeStorage(initial: LibraryEntry[] = []) {
  let held = initial;
  const writes: number[][] = [];
  const store: LibraryStorage = {
    load: async () => held,
    save: async (entries) => {
      held = entries.slice();
      writes.push(held.map((e) => (e.vector ? 1 : 0)));
    },
  };
  return { store, writes, held: () => held };
}

/** Embedding that answers a fixed vector for everything it is given. */
const fakeEmbed = (vector: number[] = [1, 0], model = 'm') =>
  vi.fn(async (entries: readonly LibraryEntry[]) => ({
    vectors: new Map(entries.map((e) => [e.id, Float32Array.from(vector)])),
    model,
    missing: 0,
  }));

const fakeEmbedTexts = (vector: number[] = [1, 0], model = 'm') =>
  vi.fn(async (texts: readonly string[]) => ({
    vectors: texts.map(() => Float32Array.from(vector)),
    model,
  }));

const deps = (over: Partial<LibraryDeps> = {}): LibraryDeps => ({
  storage: fakeStorage().store,
  embedEntries: fakeEmbed() as unknown as LibraryDeps['embedEntries'],
  embedTexts: fakeEmbedTexts() as unknown as LibraryDeps['embedTexts'],
  ...over,
});

describe('importReports', () => {
  it('chunks a report into the library and embeds it', async () => {
    const storage = fakeStorage();
    const result = await importReports([{ name: 'a.repx', text: report(label('Arial, 9pt')) }], deps({ storage: storage.store }), {
      apiKey: 'k',
    });

    expect(result.added).toBe(2); // the band and its label
    expect(result.embedded).toBe(2);
    expect(result.pending).toBe(0);
    expect(storage.held()).toHaveLength(2);
  });

  it('saves before it embeds, so a failed request cannot discard the chunking', async () => {
    const storage = fakeStorage();
    const failing = vi.fn(async () => {
      throw new Error('the key was rejected');
    });

    await expect(
      importReports([{ name: 'a.repx', text: report(label('Arial, 9pt')) }], deps({ storage: storage.store, embedEntries: failing as never }), {
        apiKey: 'k',
      }),
    ).rejects.toThrow(/rejected/);

    // The write happened anyway, and everything in it is pending rather than lost.
    expect(storage.writes).toHaveLength(1);
    expect(storage.held()).toHaveLength(2);
    expect(storage.held().every((e) => e.vector === null)).toBe(true);
  });

  it('finishes a half-embedded library on the next import', async () => {
    const storage = fakeStorage();
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      importReports([{ name: 'a.repx', text: report(label('Arial, 9pt')) }], deps({ storage: storage.store, embedEntries: failing as never }), { apiKey: 'k' }),
    ).rejects.toThrow();

    const second = await importReports([], deps({ storage: storage.store }), { apiKey: 'k' });
    expect(second.added).toBe(0);
    expect(second.embedded).toBe(2);
    expect(storage.held().every((e) => e.vector !== null)).toBe(true);
  });

  it('skips a report it already holds rather than paying for it twice', async () => {
    const storage = fakeStorage();
    const file = { name: 'a.repx', text: report(label('Arial, 9pt')) };
    await importReports([file], deps({ storage: storage.store }), { apiKey: 'k' });

    const embed = fakeEmbed();
    const again = await importReports([file], deps({ storage: storage.store, embedEntries: embed as never }), { apiKey: 'k' });

    expect(again.added).toBe(0);
    expect(again.skipped).toBe(2);
    expect(embed).not.toHaveBeenCalled();
  });

  it('names a file that produced nothing instead of failing the whole import', async () => {
    const storage = fakeStorage();
    const result = await importReports(
      [
        { name: 'empty.repx', text: '' },
        { name: 'junk.repx', text: 'not xml at all' },
        { name: 'good.repx', text: report(label('Arial, 9pt')) },
      ],
      deps({ storage: storage.store }),
      { apiKey: 'k' },
    );

    expect(result.empty).toEqual(['empty.repx', 'junk.repx']);
    expect(result.added).toBe(2);
  });

  it('imports several reports in one pass', async () => {
    const storage = fakeStorage();
    const result = await importReports(
      [
        { name: 'a.repx', text: report(label('Arial, 9pt')) },
        { name: 'b.repx', text: report(label('Arial, 12pt'), '40') },
      ],
      deps({ storage: storage.store }),
      { apiKey: 'k' },
    );
    expect(result.added).toBe(4);
    expect(sources(storage.held()).map((s) => s.name)).toEqual(['a.repx', 'b.repx']);
  });
});

describe('retrieveHouseStyle', () => {
  const stocked = async () => {
    const storage = fakeStorage();
    await importReports([{ name: 'a.repx', text: report(label('Arial, 9pt')) }], deps({ storage: storage.store }), { apiKey: 'k' });
    return storage;
  };

  it('returns a block when the library has something to offer', async () => {
    const storage = await stocked();
    const block = await retrieveHouseStyle(report(label('Arial, 10pt')), 'match our totals', deps({ storage: storage.store }), {
      apiKey: 'k',
    });
    expect(block).toContain('HOUSE STYLE REFERENCE');
    expect(block).toContain('ControlType="XRLabel"');
  });

  it('answers empty for an empty library, without embedding anything', async () => {
    const embedTexts = fakeEmbedTexts();
    const block = await retrieveHouseStyle(report(label('Arial, 9pt')), 'x', deps({ embedTexts: embedTexts as never }), { apiKey: 'k' });
    expect(block).toBe('');
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it('answers empty when there is nothing to ask about', async () => {
    const storage = await stocked();
    for (const [draft, instruction] of [
      [null, null],
      ['', ''],
      [undefined, '   '],
    ] as const) {
      const block = await retrieveHouseStyle(draft, instruction, deps({ storage: storage.store }), { apiKey: 'k' });
      expect(block, JSON.stringify([draft, instruction])).toBe('');
    }
  });

  it('answers empty when the library was embedded by a different model', async () => {
    // The honest nothing. searchable() filters the other space out, so this never
    // becomes a comparison between two sets of vectors.
    const storage = await stocked();
    const block = await retrieveHouseStyle(
      report(label('Arial, 10pt')),
      'x',
      deps({ storage: storage.store, embedTexts: fakeEmbedTexts([1, 0], 'a-different-model') as never }),
      { apiKey: 'k' },
    );
    expect(block).toBe('');
  });

  it('honours a canonical filter, so drafts in the library cannot become house style', async () => {
    const storage = await stocked();
    const block = await retrieveHouseStyle(report(label('Arial, 10pt')), 'x', deps({ storage: storage.store }), {
      apiKey: 'k',
      where: (entry) => entry.chunk.source === 'nothing-matches-this.repx',
    });
    expect(block).toBe('');
  });

  it('passes the block options through to the formatter', async () => {
    const storage = await stocked();
    const block = await retrieveHouseStyle(report(label('Arial, 10pt')), 'x', deps({ storage: storage.store }), {
      apiKey: 'k',
      maxExamples: 1,
    });
    expect(block.match(/--- example \d+:/g)).toHaveLength(1);
  });
});

describe('sources', () => {
  it('counts chunks and embeddings per file, sorted by name', async () => {
    const storage = fakeStorage();
    await importReports(
      [
        { name: 'b.repx', text: report(label('Arial, 9pt')) },
        { name: 'a.repx', text: report(label('Arial, 12pt'), '40') },
      ],
      deps({ storage: storage.store }),
      { apiKey: 'k' },
    );

    const rows = sources(storage.held());
    expect(rows.map((r) => r.name)).toEqual(['a.repx', 'b.repx']);
    expect(rows[0].chunks).toBe(2);
    expect(rows[0].embedded).toBe(2);
  });

  it('is empty for an empty library', () => {
    expect(sources([])).toEqual([]);
  });
});

describe('removeSource', () => {
  it('takes one file back out and leaves the rest', async () => {
    const storage = fakeStorage();
    await importReports(
      [
        { name: 'a.repx', text: report(label('Arial, 9pt')) },
        { name: 'b.repx', text: report(label('Arial, 12pt'), '40') },
      ],
      deps({ storage: storage.store }),
      { apiKey: 'k' },
    );

    const left = await removeSource('a.repx', deps({ storage: storage.store }));
    expect(sources(left).map((s) => s.name)).toEqual(['b.repx']);
    expect(sources(storage.held()).map((s) => s.name)).toEqual(['b.repx']);
  });
});

/** The kept reports' store, in memory. */
function fakeKept(initial: KeptRecord[] = []) {
  let held = initial;
  const store: KeptStorage = {
    load: async () => held,
    save: async (records) => {
      held = records.slice();
    },
  };
  return { store, held: () => held };
}

const keptReport = (over: Partial<KeptReport> = {}): KeptReport => ({
  id: 'project-1',
  owner: null,
  name: 'Invoice',
  features: [1, 0],
  category: 'invoice',
  face: 'Arial',
  titleSize: 14,
  repx: report(label('Arial, 9pt')),
  ...over,
});

/* The reports a person keeps (2026-11-11, D2 and D3). */
describe('keepReport', () => {
  it('keeps a report stripped, as an added one is, and sends nothing anywhere', async () => {
    const kept = fakeKept();
    const d = deps({ kept: kept.store });
    const secret = report('<Item1 Ref="2" ControlType="XRLabel" Name="lblClient" Text="Acme Private Ltd" Font="Arial, 9pt" />');
    expect(await keepReport(keptReport({ repx: secret }), d, { now: 5 })).toBe(true);
    const [record] = kept.held();
    expect(record).toMatchObject({ id: 'project-1', name: 'Invoice', at: 5, category: 'invoice' });
    expect(record.chunks.length).toBeGreaterThan(0);
    expect(JSON.stringify(record.chunks)).not.toMatch(/Acme|Private|lblClient/);
    expect(d.embedEntries).not.toHaveBeenCalled();
    expect(d.embedTexts).not.toHaveBeenCalled();
  });

  it('replaces what the same report left before, and what it left before it had a project', async () => {
    const kept = fakeKept();
    const d = deps({ kept: kept.store });
    await keepReport(keptReport({ id: 's-shape' }), d, { now: 1 });
    await keepReport(keptReport(), d, { now: 2, replaces: 's-shape' });
    await keepReport(keptReport(), d, { now: 3 });
    expect(kept.held().map((r) => [r.id, r.at])).toEqual([['project-1', 3]]);
  });

  it('keeps the newest, the oldest going first', async () => {
    const kept = fakeKept();
    const d = deps({ kept: kept.store });
    for (let i = 0; i < MAX_KEPT_REPORTS + 3; i++) await keepReport(keptReport({ id: `p${i}`, name: `R${i}` }), d, { now: i });
    expect(kept.held()).toHaveLength(MAX_KEPT_REPORTS);
    expect(kept.held()[0].id).toBe('p3');
  });

  it('keeps nothing with nowhere to keep it, or a file with no part to keep', async () => {
    expect(await keepReport(keptReport(), deps())).toBe(false);
    const kept = fakeKept();
    expect(await keepReport(keptReport({ repx: 'not a report' }), deps({ kept: kept.store }))).toBe(false);
    expect(kept.held()).toEqual([]);
  });
});

describe('nearestKept', () => {
  const record = (id: string, features: number[], category: string | null, at = 0): KeptRecord => ({ id, owner: null, name: id, at, features, category, face: 'Arial', titleSize: 14, chunks: [] });

  it('finds the kept report shaped most like the new one, the category the words name counting most', () => {
    const scale = { sd: [1, 1] };
    const records = [record('list', [0, 0], 'list'), record('invoice', [2.4, 0], 'invoice')];
    expect(nearestKept({ features: [0.5, 0], category: null }, records, scale)?.record.id).toBe('list');
    expect(nearestKept({ features: [0.5, 0], category: 'invoice' }, records, scale)?.record.id).toBe('invoice');
    // Equally near: the newer one.
    expect(nearestKept({ features: [1, 0], category: null }, [record('a', [0, 0], null, 1), record('b', [2, 0], null, 2)], scale)?.record.id).toBe('b');
    expect(nearestKept({ features: [1, 0], category: null }, [], scale)).toBeNull();
    // One measured another way cannot be compared.
    expect(nearestKept({ features: [1, 0], category: null }, [record('x', [1, 0, 0], null)], scale)).toBeNull();
  });
});

describe('the kept reports in the panel', () => {
  it('are listed by name beside the added files, and removed by the same Remove', async () => {
    const storage = fakeStorage();
    const kept = fakeKept();
    const d = deps({ storage: storage.store, kept: kept.store });
    await importReports([{ name: 'a.repx', text: report(label('Arial, 9pt')) }], d, { apiKey: 'k' });
    await keepReport(keptReport({ name: 'Invoice' }), d);
    await keepReport(keptReport({ id: 'p2', name: 'a.repx' }), d);
    const rows = await listSources(d);
    expect(rows.map((r) => [r.name, r.kept ?? false])).toEqual([['a.repx', false], ['Invoice', true]]);
    expect(rows[1].embedded).toBe(rows[1].chunks);
    await removeSource('Invoice', d);
    expect((await listSources(d)).map((r) => r.name)).toEqual(['a.repx']);
    // An added file and a kept report of one name go together.
    await removeSource('a.repx', d);
    expect(kept.held()).toEqual([]);
  });

  /* The LRN2 review (2026-11-11): the store is per browser, the memory per account. */
  it("are listed only to whoever kept them, and someone else's go when a report is kept", async () => {
    const kept = fakeKept();
    const d = deps({ kept: kept.store });
    await keepReport(keptReport({ id: 's1', name: 'Payroll' }), d, { now: 1 });
    expect((await listSources(d, 'alice')).map((r) => r.name)).toEqual([]);
    expect((await listSources(d, null)).map((r) => r.name)).toEqual(['Payroll']);
    await keepReport(keptReport({ owner: 'alice', name: 'Invoice' }), d, { now: 2 });
    expect(kept.held().map((r) => [r.owner, r.name])).toEqual([['alice', 'Invoice']]);
    expect((await listSources(d, null)).map((r) => r.name)).toEqual([]);
  });

  it("are forgotten for one person by Settings' Forget, and nobody else's are touched", async () => {
    const kept = fakeKept();
    const d = deps({ kept: kept.store });
    await keepReport(keptReport({ owner: 'alice' }), d, { now: 1 });
    await forgetKept('bob', d);
    expect(kept.held()).toHaveLength(1);
    await forgetKept('alice', d);
    expect(kept.held()).toEqual([]);
    expect((await listSources(d, 'alice')).map((r) => r.name)).toEqual([]);
    // Nowhere to keep them: nothing to forget, and no error.
    await expect(forgetKept('alice', deps())).resolves.toBeUndefined();
  });
});
