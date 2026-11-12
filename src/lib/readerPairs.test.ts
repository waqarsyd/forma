/**
 * The box reader learning from use (2026-11-12, Owner decision 20, the full
 * audit's D10; lib/readerPairs.ts): a page read in numbers alone, never a
 * character of it, labelled by the report kept from it, checked on the
 * owner's side, and turned into the rows the reader trains on, those rows
 * being exactly what the reader computes of the page. Against the shipped
 * reader, as boxReader.test.ts reads it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOX_FEATURES, LINE_FEATURES, READER_BANDS, boxFeatures, lineFeatures, linesOf, readBoxes, type BoxReaderModel, type ReadBox } from './boxReader';
import type { DetectedPage, DetectedText } from './ocrLayout';
import type { OcrLine, OcrPage, OcrWord } from './ocr';
import { buildWithReader } from './ocrAttach';
import { parseReportStructure } from './reportPreview';
import { skeletonOf, type ReportSkeleton, type SkeletonControl } from './reportSkeleton';
import { DEFAULT_UNIT, unitsPerInch } from './reportGeometry';
import { MAX_BOXES_CHARS } from './learning';
import {
  BOX_OWN,
  FEATURE_SIGNATURE,
  MAX_PAIR_CHARS,
  decodedBands,
  labelReading,
  pageReadingOf,
  pairPage,
  pairRoleRows,
  pairsOfFolder,
  readerPairOf,
  roleInput,
  scorePairPages,
  soundPair,
  type ReaderPair,
} from './readerPairs';

const model = JSON.parse(readFileSync('assets/model/boxReader.json', 'utf8')) as BoxReaderModel;

// The A4 page boxReader.test.ts reads: a title, a row of headings, four
// records, a total under the amounts, and the page number at the foot.
const t = (x: number, y: number, w: number, text: string, h = 8): ReadBox => ({ x, y, w, h, text });
const boxes: ReadBox[] = [
  t(300, 60, 200, 'Monthly sales', 14),
  t(100, 120, 60, 'Customer'),
  t(400, 120, 40, 'Date'),
  t(640, 120, 50, 'Amount'),
  ...[0, 1, 2, 3].flatMap((r) => [t(100, 140 + r * 18, 80, `Name ${r}`), t(400, 140 + r * 18, 60, '01/02/2026'), t(650, 140 + r * 18, 40, '1,250.00')]),
  t(560, 220, 50, 'Total'),
  t(640, 220, 50, '5,000.00'),
  t(360, 1080, 70, 'Page 1 of 1'),
];
const detected = (b: ReadBox): DetectedText => ({ text: b.text, x: b.x, y: b.y, w: b.w, h: b.h, ink: { x: b.x, y: b.y, w: b.w, h: b.h }, fontSize: 9, confidence: 95, flagged: false, words: [] });
const page: DetectedPage = { width: 827, height: 1169, margins: { left: 50, right: 50, top: 50, bottom: 50 }, labels: boxes.map(detected), tables: [], ignored: [] };

const label = (kind: string, role: string, x: number, y: number, w: number, h = 8, chars = 5): SkeletonControl =>
  ({ kind, role, x, y, w, h, font: null, align: 'left', borders: 0, chars }) as SkeletonControl;
/** The report a person kept from that page, in hundredths of an inch, as a skeleton. */
const kept: ReportSkeleton = {
  paper: 'A4',
  landscape: false,
  width: 827,
  height: 1169,
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  bands: [
    { kind: 'TopMargin', height: 50, groupFields: 0, controls: [] },
    { kind: 'ReportHeader', height: 30, groupFields: 0, controls: [label('label', 'title', 250, 10, 200, 14)] },
    { kind: 'PageHeader', height: 50, groupFields: 0, controls: [label('label', 'caption', 50, 40, 80), label('label', 'caption', 350, 40, 60), label('label', 'caption', 590, 40, 50)] },
    { kind: 'Detail', height: 18, groupFields: 0, controls: [label('label', 'value', 50, 0, 80, 8, 0), label('label', 'value', 350, 0, 60, 8, 0), label('label', 'value', 600, 0, 40, 8, 0)] },
    { kind: 'ReportFooter', height: 20, groupFields: 0, controls: [label('label', 'caption', 510, 0, 50), label('label', 'total', 590, 0, 50, 8, 0)] },
    { kind: 'PageFooter', height: 40, groupFields: 0, controls: [label('pageInfo', 'pageInfo', 310, 1, 70, 8, 0)] },
    { kind: 'BottomMargin', height: 50, groupFields: 0, controls: [] },
  ],
};
const band = (name: string) => READER_BANDS.indexOf(name as (typeof READER_BANDS)[number]);

describe('a page read in numbers alone', () => {
  const reading = pageReadingOf(model, page)!;

  it('lays a text\'s features out as its own, its line\'s band, then its line\'s', () => {
    expect(BOX_OWN).toBe(30);
    expect(BOX_FEATURES[BOX_OWN]).toBe('bandTopMargin');
    expect(BOX_FEATURES).toHaveLength(BOX_OWN + READER_BANDS.length + LINE_FEATURES.length);
    expect(FEATURE_SIGNATURE).toMatch(/^[0-9a-f]{8}$/);
  });

  it('holds no character of the page, only where its texts sit and the reader\'s numbers', () => {
    const json = JSON.stringify(reading);
    for (const b of boxes) expect(json).not.toContain(b.text);
    expect(json).not.toMatch(/Monthly|Customer|Amount|Total|Page 1|Name \d|1,250|01\/02/);
    expect(reading.boxes).toHaveLength(boxes.length);
    expect(reading.boxes[0]).toEqual([300, 60, 200, 14]);
    expect(reading.lineFeatures.every((f) => f.length === LINE_FEATURES.length)).toBe(true);
    expect(reading.boxFeatures.every((f) => f.length === BOX_OWN)).toBe(true);
    expect(reading.lines.flat().sort((a, b) => a - b)).toEqual(boxes.map((_, k) => k));
  });

  it('decodes the bands the reader\'s role network is given, and keeps what it made of the page', () => {
    const lines = linesOf(boxes);
    const lf = lineFeatures(page, boxes, lines);
    expect(decodedBands(model, boxes, lines, lf)).toEqual(readBoxes(model, page, boxes, false).bands);
    const settled = readBoxes(model, page, boxes);
    expect(reading.readBand).toEqual(settled.bands.map((b) => READER_BANDS.indexOf(b)));
  });

  it('keeps nothing of a page with no text, or too many', () => {
    expect(pageReadingOf(model, { ...page, labels: [] })).toBeNull();
    expect(pageReadingOf(model, { ...page, labels: Array.from({ length: 501 }, (_, i) => detected(t(10, 10 + i, 20, 'x'))) })).toBeNull();
  });
});

describe('labelled by the report kept', () => {
  const reading = pageReadingOf(model, page)!;

  it('gives each text the band and role it ended in, the records each time they print', () => {
    const { band: bands, role: roles, labelled } = labelReading(reading, kept);
    expect(labelled).toBe(boxes.length);
    expect(bands).toEqual([band('ReportHeader'), ...[0, 1, 2].map(() => band('PageHeader')), ...new Array(12).fill(band('Detail')), band('ReportFooter'), band('ReportFooter'), band('PageFooter')]);
    // title 0, caption 1, value 2, total 3, page information 4.
    expect(roles).toEqual([0, 1, 1, 1, ...new Array(12).fill(2), 1, 3, 4]);
  });

  it('leaves out what the report does not account for, and makes no pair of a page it is not', () => {
    const elsewhere: ReportSkeleton = { ...kept, bands: [{ kind: 'Detail', height: 20, groupFields: 0, controls: [label('label', 'value', 0, 0, 20, 8, 0)] }] };
    const { labelled } = labelReading(reading, elsewhere);
    expect(labelled).toBeLessThan(boxes.length / 2);
    expect(readerPairOf(reading, elsewhere)).toEqual({ json: null, tooLarge: false });
  });

  it('makes a pair of numbers and labels, which the owner\'s side takes back as it was', () => {
    const { json, tooLarge } = readerPairOf(reading, kept);
    expect(tooLarge).toBe(false);
    for (const b of boxes) expect(json).not.toContain(b.text);
    const pair = soundPair(json)!;
    expect(pair).not.toBeNull();
    expect(pair.band).toEqual(labelReading(reading, kept).band);
    expect(json!.length).toBeLessThan(MAX_PAIR_CHARS);
  });

  it('is labelled by the reader\'s own report, kept as it made it, end to end', () => {
    const lineOfWords = (bs: ReadBox[]): OcrLine => {
      const words: OcrWord[] = bs.map((b) => ({ text: b.text, confidence: 95, box: { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } }));
      const box = { x0: Math.min(...bs.map((b) => b.x)), y0: Math.min(...bs.map((b) => b.y)), x1: Math.max(...bs.map((b) => b.x + b.w)), y1: Math.max(...bs.map((b) => b.y + b.h)) };
      return { text: bs.map((b) => b.text).join(' '), confidence: 95, box, words };
    };
    const ocr: OcrPage = { width: 827, height: 1169, dpi: 100, lines: linesOf(boxes).map((l) => lineOfWords(l.boxes.map((k) => boxes[k]))) };
    const built = buildWithReader([{ meta: { uploadId: 'u1', file: 'sales.png' }, read: { ocr, flagged: 0, lines: ocr.lines.length } }], model, 'A4')!;
    expect(built.pageReading).toBeTruthy();
    const keptReport = skeletonOf(parseReportStructure(built.repxContent, { dpi: unitsPerInch(DEFAULT_UNIT), unit: DEFAULT_UNIT }));
    const { labelled } = labelReading(built.pageReading!, keptReport);
    expect(labelled).toBeGreaterThanOrEqual(built.pageReading!.boxes.length / 2);
    expect(readerPairOf(built.pageReading!, keptReport).json).toBeTruthy();
  });
});

describe('on the owner\'s side', () => {
  const reading = pageReadingOf(model, page)!;
  const pair = soundPair(readerPairOf(reading, kept).json)!;

  it('turns a pair into exactly the features the reader computes of the page', () => {
    const p = pairPage(pair);
    const lines = linesOf(boxes);
    const lf = lineFeatures(page, boxes, lines);
    const bands = decodedBands(model, boxes, lines, lf);
    const full = boxFeatures(page, boxes, lines, bands, lf);
    boxes.forEach((_, k) => {
      const mine = roleInput(p, k, bands);
      expect(mine).toHaveLength(BOX_FEATURES.length);
      mine.forEach((v, i) => expect(v).toBeCloseTo(full[k][i], 2));
    });
    // The second look reads the boxes' places alone, so the pair's give the reader's bands.
    expect(decodedBands(model, p.boxes, p.lines, p.lineFeats)).toEqual(bands);
    expect(pairRoleRows(p, bands)).toHaveLength(boxes.length);
    expect(p.lineLabel[0]).toBe(band('ReportHeader'));
  });

  it('refuses a pair read with other features, of the wrong lengths, or with a text in two lines', () => {
    expect(soundPair({ ...pair, features: '00000000' })).toBeNull();
    expect(soundPair({ ...pair, band: pair.band.slice(1) })).toBeNull();
    expect(soundPair({ ...pair, lines: [[0, 0], ...pair.lines.slice(1)] })).toBeNull();
    expect(soundPair({ ...pair, role: pair.role.map(() => 9) })).toBeNull();
    expect(soundPair({ ...pair, lineFeatures: pair.lineFeatures.map((f) => f.slice(1)) })).toBeNull();
    expect(soundPair({ ...pair, boxes: pair.boxes.map(() => [Number.NaN, 0, 1, 1]) })).toBeNull();
    expect(soundPair('not json')).toBeNull();
    // A field added on the way is not carried.
    expect(soundPair({ ...pair, note: 'Monthly sales' })).not.toHaveProperty('note');
  });

  it('keeps the newest pair of a report kept twice, and passes over what is not one', () => {
    const older: ReaderPair = { ...pair, role: pair.role.map(() => -1) };
    const files = [JSON.stringify({ ref: 'g1', at: '2026-11-12T10:00:00Z', pair: older }), JSON.stringify({ ref: 'g1', at: '2026-11-12T11:00:00Z', pair }), JSON.stringify({ ref: 'g2', at: '2026-11-12T09:00:00Z', pair: { v: 2 } }), 'nonsense'];
    const got = pairsOfFolder(files);
    expect(got).toHaveLength(1);
    expect(got[0].role).toEqual(pair.role);
  });

  it('scores the reader as it read the page in use, and as trained, against the report kept', () => {
    const s = scorePairPages(model, [pairPage(pair)]);
    expect(s.shipped.texts).toBe(boxes.length);
    expect(s.model.texts).toBe(boxes.length);
    expect(s.shipped.both).toBeLessThanOrEqual(s.shipped.band);
    expect(s.model.band).toBeGreaterThan(0);
  });

  it('caps a pair where learning.ts and the rules do', () => {
    expect(MAX_BOXES_CHARS).toBe(MAX_PAIR_CHARS);
    expect(readFileSync('firestore.rules', 'utf8')).toContain(`data.boxes.size() <= ${MAX_PAIR_CHARS}`);
  });
});
