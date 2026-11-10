/**
 * Learning from use (2026-11-10, the full audit): what an event carries on
 * each tier, the scrub that keeps a skeleton to its fixed words, and the
 * settings' defaults.
 */
import { describe, expect, it } from 'vitest';
import type { ReportSkeleton } from './reportSkeleton';
import {
  DEFAULT_LEARNING_SETTINGS,
  learningEvent,
  learningId,
  learningSummary,
  readLearningSettings,
  scrubSkeleton,
  sendable,
  skeletonField,
  sourceOf,
  writeLearningSettings,
} from './learning';

const skeleton: ReportSkeleton = {
  paper: 'A4',
  landscape: false,
  width: 827,
  height: 1169,
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  bands: [
    {
      kind: 'ReportHeader',
      height: 100,
      groupFields: 0,
      controls: [{ kind: 'label', role: 'title', x: 0, y: 0, w: 300, h: 30, font: { family: 'Tahoma', size: 14, bold: true, italic: false }, align: 'left', borders: 0, chars: 12 }],
    },
    {
      kind: 'Detail',
      height: 20,
      groupFields: 0,
      controls: [{ kind: 'table', role: 'value', x: 0, y: 0, w: 700, h: 20, font: null, align: 'left', borders: 15, chars: 0, rows: [[{ weight: 1, role: 'value', align: 'right', chars: 0, font: null }]] }],
    },
  ],
};

function fakeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('the settings', () => {
  it('default to structure on and full reports off, and keep what is written', () => {
    const storage = fakeStorage();
    expect(readLearningSettings(storage)).toEqual(DEFAULT_LEARNING_SETTINGS);
    expect(DEFAULT_LEARNING_SETTINGS).toEqual({ structure: true, full: false });
    writeLearningSettings({ structure: false, full: true }, storage);
    expect(readLearningSettings(storage)).toEqual({ structure: false, full: true });
    storage.map.set('forma:learning', '{not json');
    expect(readLearningSettings(storage)).toEqual(DEFAULT_LEARNING_SETTINGS);
    expect(readLearningSettings(null)).toEqual(DEFAULT_LEARNING_SETTINGS);
  });
});

describe('the scrub', () => {
  it('leaves a sound skeleton as it is', () => {
    expect(scrubSkeleton(skeleton)).toEqual(skeleton);
  });

  it('strips any string that is not one of the fixed words, wherever a defect put it', () => {
    const leaky = JSON.parse(JSON.stringify(skeleton)) as ReportSkeleton & { bands: ({ text?: string } & ReportSkeleton['bands'][number])[] };
    leaky.bands[0].text = 'ACME Ltd, 14 High Street';
    (leaky.bands[0].controls[0] as { name?: string }).name = 'lblCustomerName';
    leaky.bands[0].controls[0].font!.family = 'Tahoma <script>';
    (leaky as unknown as { paper: string }).paper = 'A4; DROP TABLE';
    const clean = scrubSkeleton(leaky) as unknown as { bands: { text: string; controls: { name: string; font: { family: string } }[] }[]; paper: string };
    expect(clean.bands[0].text).toBe('');
    expect(clean.bands[0].controls[0].name).toBe('');
    expect(clean.bands[0].controls[0].font.family).toBe('');
    expect(clean.paper).toBe('');
    expect(clean.bands[0].controls[0]).toMatchObject({ kind: 'label', role: 'title', w: 300 });
  });

  it('writes the skeleton as JSON, and nothing when there is none or it would not fit', () => {
    expect(JSON.parse(skeletonField(skeleton))).toEqual(skeleton);
    expect(skeletonField(null)).toBe('');
    const huge = { ...skeleton, bands: Array.from({ length: 3000 }, () => skeleton.bands[1]) };
    expect(skeletonField(huge)).toBe('');
  });
});

describe('an event', () => {
  const settings = { structure: true, full: false };

  it('carries the structure and never the report or the words on the structure tier', () => {
    const e = learningEvent(
      { kind: 'generation', source: 'image', request: 'new', ai: 'gemini', skeleton, ops: ['font', 'move'], findings: [{ severity: 'error' }, { severity: 'warning' }, { severity: 'warning' }], repx: '<XtraReportsLayoutSerializer/>', prompt: 'Rebuild this invoice' },
      settings,
      new Date('2026-11-10T20:15:00Z'),
    );
    expect(e).toMatchObject({ at: '2026-11-10T20:15:00.000Z', day: '2026-11-10', kind: 'generation', source: 'image', request: 'new', ai: 'gemini', ops: ['font', 'move'], errors: 1, warnings: 2, rating: '', full: '', prompt: '' });
    expect(JSON.parse(e.skeleton)).toEqual(skeleton);
    expect(e.id).toMatch(/^[a-z0-9]+-[a-z0-9]{6}$/);
    expect(sendable(e, settings)).toBe(true);
    expect(sendable(e, { structure: false, full: false })).toBe(false);
  });

  it('carries the report and the words only on the full tier, within their limits', () => {
    const full = { structure: true, full: true };
    const e = learningEvent({ kind: 'edit', skeleton, ops: ['text'], repx: '<x/>', prompt: 'p'.repeat(5000) }, full);
    expect(e.full).toBe('<x/>');
    expect(e.prompt).toHaveLength(4000);
    expect(sendable(e, { structure: false, full: true })).toBe(true);
    const tooBig = learningEvent({ kind: 'edit', repx: 'x'.repeat(400_001), prompt: 'p' }, full);
    expect(tooBig.full).toBe('');
    expect(tooBig.prompt).toBe('');
  });

  it('keeps every field present, with the defaults, so the rules can pin the shape', () => {
    const e = learningEvent({ kind: 'rating', rating: 'good' }, settings);
    expect(Object.keys(e).sort()).toEqual(['ai', 'at', 'day', 'errors', 'full', 'id', 'kind', 'ops', 'prompt', 'rating', 'request', 'skeleton', 'source', 'userId', 'warnings'].filter((k) => k !== 'userId').sort());
    expect(e).toMatchObject({ source: 'none', request: 'none', ai: 'none', skeleton: '', ops: [], errors: 0, warnings: 0, rating: 'good' });
  });

  it('caps the operations at forty short names', () => {
    const e = learningEvent({ kind: 'edit', ops: Array.from({ length: 60 }, (_, i) => `op${i}`.padEnd(40, 'x')) }, settings);
    expect(e.ops).toHaveLength(40);
    expect(e.ops[0]).toHaveLength(24);
  });

  it('gives ids that stay unique within one millisecond', () => {
    const a = learningId(1000);
    const b = learningId(1000);
    expect(a).not.toBe(b);
  });
});

describe('what the request brought', () => {
  it('names one kind, or mixed', () => {
    expect(sourceOf({ images: 2, pdfs: 0, repx: 0, words: true, database: false })).toBe('image');
    expect(sourceOf({ images: 0, pdfs: 1, repx: 0, words: false, database: false })).toBe('pdf');
    expect(sourceOf({ images: 0, pdfs: 0, repx: 1, words: false, database: false })).toBe('repx');
    expect(sourceOf({ images: 0, pdfs: 0, repx: 0, words: true, database: false })).toBe('words');
    expect(sourceOf({ images: 0, pdfs: 0, repx: 0, words: false, database: true })).toBe('database');
    expect(sourceOf({ images: 1, pdfs: 0, repx: 1, words: true, database: false })).toBe('mixed');
    expect(sourceOf({ images: 0, pdfs: 0, repx: 0, words: false, database: false })).toBe('none');
  });
});

describe('the summary', () => {
  it('counts by kind and the full reports, from the earliest', () => {
    const s = { structure: true, full: true };
    const events = [
      learningEvent({ kind: 'generation', skeleton, repx: '<x/>' }, s, new Date('2026-11-10T10:00:00Z')),
      learningEvent({ kind: 'edit', ops: ['font'] }, s, new Date('2026-11-09T10:00:00Z')),
      learningEvent({ kind: 'rating', rating: 'bad' }, s, new Date('2026-11-11T10:00:00Z')),
    ];
    expect(learningSummary(events)).toEqual({ total: 3, byKind: { generation: 1, edit: 1, translate: 0, rating: 1 }, full: 1, since: '2026-11-09T10:00:00.000Z' });
    expect(learningSummary([])).toEqual({ total: 0, byKind: { generation: 0, edit: 0, translate: 0, rating: 0 }, full: 0, since: null });
  });
});
