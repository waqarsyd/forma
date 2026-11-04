import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOX_FEATURES,
  LINE_FEATURES,
  READER_BANDS,
  READER_ROLES,
  boxFeatures,
  decodeBands,
  lineFeatures,
  linesOf,
  loadBoxReader,
  mlpProbs,
  readBoxes,
  readerSkeleton,
  readsTheseFeatures,
  settleRecords,
  type BoxReaderModel,
  type BoxReading,
  type Mlp,
  type ReadBox,
} from './boxReader';
import type { OcrLine, OcrPage, OcrWord } from './ocr';
import { buildWithReader } from './ocrAttach';
import { skeletonToDesign } from './skeletonRepx';
import { fixedPlaces } from './skeletonText';

// An A4 page as OCR reads one: a title, a row of column headings, four
// records, a total under the amounts, and the page number at the foot.
const page = { width: 827, height: 1169 };
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

describe('lines', () => {
  it('groups texts by the line they print on, left to right', () => {
    const lines = linesOf([t(400, 100, 40, 'b'), t(100, 102, 60, 'a'), t(100, 120, 60, 'c'), t(90, 96, 300, 'tall', 16)]);
    expect(lines.map((l) => l.boxes)).toEqual([[3, 1, 0], [2]]);
    expect(lines[0]).toMatchObject({ top: 96, bottom: 112, left: 90, right: 440 });
  });

  it('gives every line and every text its features, all finite', () => {
    const lines = linesOf(boxes);
    expect(lines).toHaveLength(8);
    const lf = lineFeatures(page, boxes, lines);
    expect(lf.every((f) => f.length === LINE_FEATURES.length && f.every(Number.isFinite))).toBe(true);
    const bf = boxFeatures(page, boxes, lines, lines.map(() => 'Detail'), lf);
    expect(bf).toHaveLength(boxes.length);
    expect(bf.every((f) => f.length === BOX_FEATURES.length && f.every(Number.isFinite))).toBe(true);
    // The four records share a shape with each other and with the headings
    // over their columns, so each repeats four times; the total does not.
    const repeats = LINE_FEATURES.indexOf('repeats');
    expect(lf.slice(1, 6).map((f) => f[repeats])).toEqual(new Array(5).fill(Math.log1p(4)));
    expect(lf[6][repeats]).toBe(0);
    expect(lf[6][LINE_FEATURES.indexOf('recordAbove')]).toBe(1);
    expect(lf[6][LINE_FEATURES.indexOf('inRecordColumns')]).toBe(0.5);
  });
});

describe('the networks and the decoding', () => {
  it('scores with a small network as written', () => {
    // Two inputs, two hidden units, two outputs: output 1 follows input 0.
    const m: Mlp = { inputs: 2, hidden: 2, outputs: 2, mean: [0, 0], scale: [1, 1], w1: [1, 0, 0, 1], b1: [0, 0], w2: [0, 0, 5, 0], b2: [0, 0] };
    const p = mlpProbs(m, [2, 0]);
    expect(p[0] + p[1]).toBeCloseTo(1, 10);
    expect(p[1]).toBeGreaterThan(0.99);
    expect(mlpProbs(m, [-2, 0])).toEqual([0.5, 0.5]);
  });

  it('never decodes a band that cannot follow the one above it', () => {
    const K = READER_BANDS.length;
    const detail = READER_BANDS.indexOf('Detail');
    const header = READER_BANDS.indexOf('PageHeader');
    const flat = new Array(K).fill(Math.log(1 / K));
    const transitions = READER_BANDS.map((_, from) => READER_BANDS.map((__, to) => (from === detail && to === header ? -50 : Math.log(1 / K))));
    // Most on one band, a quarter on a second, the rest spread thin.
    const prefer = (k: number, second = k) => READER_BANDS.map((_, j) => (j === k ? 0.6 : j === second ? 0.25 : 0.15 / (K - 2)));
    expect(decodeBands([prefer(header), prefer(detail), prefer(detail)], flat, transitions)).toEqual([header, detail, detail]);
    // The third line leans to a page header, but one cannot follow the records, so it is its second choice.
    expect(decodeBands([prefer(header), prefer(detail), prefer(header, detail)], flat, transitions)).toEqual([header, detail, detail]);
  });
});

describe('the skeleton', () => {
  // The reading a right answer gives: a band per line, a role per text.
  const reading: BoxReading = {
    lines: linesOf(boxes),
    bands: ['ReportHeader', 'PageHeader', 'Detail', 'Detail', 'Detail', 'Detail', 'ReportFooter', 'PageFooter'],
    roles: boxes.map((b, k) => (k === 0 ? 'title' : k <= 3 || b.text === 'Total' ? 'caption' : b.text.startsWith('Page') ? 'pageInfo' : k === boxes.length - 2 ? 'total' : 'value')),
  };

  it('keeps each band once and the first record, with every text where OCR read it', () => {
    const k = readerSkeleton({ ...page, margins: { top: 50, bottom: 50, left: 50, right: 50 } }, boxes, reading);
    expect(k.paper).toBe('A4');
    expect(k.bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'PageHeader', 'Detail', 'ReportFooter', 'PageFooter', 'BottomMargin']);
    const detail = k.bands.find((b) => b.kind === 'Detail')!;
    expect(detail.controls.map((c) => c.role)).toEqual(['value', 'value', 'value']);
    // The record is as tall as records print apart.
    expect(detail.height).toBe(18);
    // Stacked from the top margin, the headers and the first record land where they were read.
    const placed = fixedPlaces(k).places.map((p) => [Math.round(p.x), Math.round(p.y)]);
    expect(placed).toEqual(expect.arrayContaining([[300, 60], [100, 120], [640, 120], [360, 1080]]));
    expect(k.bands.find((b) => b.kind === 'PageFooter')!.controls[0]).toMatchObject({ kind: 'pageInfo', role: 'pageInfo' });
  });

  it('keeps one record, however its lines repeat', () => {
    const detailOnly = (bs: ReadBox[]): BoxReading => {
      const lines = linesOf(bs);
      return { lines, bands: lines.map(() => 'Detail'), roles: bs.map((b) => (/:$/.test(b.text) ? 'caption' : 'value')) };
    };
    const detailOf = (bs: ReadBox[]) => readerSkeleton(page, bs, detailOnly(bs)).bands.find((b) => b.kind === 'Detail')!;
    // One-line records whose code recurs four lines apart by chance: still one line a record.
    const codes = ['INV-1', 'PO-2', 'GRN-3', 'ITM-4', 'INV-1', 'PO-6', 'GRN-7', 'DN-8', 'INV-9'];
    const listing = codes.flatMap((c, r) => [t(100, 300 + r * 18, 40, c), t(650, 300 + r * 18, 40, `${r},250.00`)]);
    expect(detailOf(listing).controls).toHaveLength(2);
    // Records of two lines, a caption and a value on each: both lines are the record.
    const pairs = [0, 1, 2, 3].flatMap((r) => [t(100, 300 + r * 40, 40, 'Qty:'), t(200, 300 + r * 40, 30, `${r + 1}`), t(100, 318 + r * 40, 40, 'Price:'), t(200, 318 + r * 40, 30, `${r}.50`)]);
    expect(detailOf(pairs).controls.map((c) => c.role)).toEqual(['caption', 'value', 'caption', 'value']);
  });

  it('becomes a report whose values are bound to fields named after their captions', () => {
    const k = readerSkeleton({ ...page, margins: { top: 50, bottom: 50, left: 50, right: 50 } }, boxes, reading);
    const design = skeletonToDesign(k, { texts: boxes });
    expect(design.title).toBe('Monthly sales');
    expect(design.fields).toEqual(['Customer', 'Date', 'Amount']);
    expect(design.repx).toContain('Text="Customer"');
    expect(design.repx).toContain('Expression="[Amount]"');
    expect(design.repx).toContain('Expression="sumSum([Amount])"');
    expect(design.repx).toContain('ControlType="XRPageInfo"');
  });
});

describe('the shipped reader', () => {
  const model = JSON.parse(readFileSync('assets/model/boxReader.json', 'utf8')) as BoxReaderModel;

  it('reads the features this version computes', () => {
    expect(readsTheseFeatures(model)).toBe(true);
    expect(model.bands).toEqual([...READER_BANDS]);
    expect(model.roles).toEqual([...READER_ROLES]);
  });

  it('holds numbers and the names of its bands, roles and features, nothing else', () => {
    const names = new Set<string>([...READER_BANDS, ...READER_ROLES, ...LINE_FEATURES, ...BOX_FEATURES]);
    const strings: string[] = [];
    const walk = (v: unknown, key = '') => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(model);
    expect(strings.filter((s) => !names.has(s))).toEqual([]);
  });

  it('reads a plain listing as headings over records', () => {
    const r = readBoxes(model, page, boxes);
    const bandOf = (k: number) => r.bands[r.lines.findIndex((l) => l.boxes.includes(k))];
    // The four records are the Detail band, their dates and amounts values.
    for (const k of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) expect(bandOf(k)).toBe('Detail');
    for (const k of [5, 6, 8, 9, 11, 12, 14, 15]) expect(r.roles[k]).toBe('value');
    // The column headings line up with the records, and are still headings, not a record.
    expect([1, 2, 3].map((k) => r.roles[k])).toEqual(['caption', 'caption', 'caption']);
    expect(['ReportHeader', 'PageHeader', 'GroupHeader']).toContain(bandOf(1));
    expect(r.roles[boxes.length - 1]).toBe('pageInfo');
    expect(bandOf(boxes.length - 1)).toBe('PageFooter');
  });

  it('settles a heading row the networks read as a record', () => {
    // The networks' reading with the headings taken for one more record.
    const lines = linesOf(boxes);
    const raw: BoxReading = {
      lines,
      bands: ['PageHeader', 'Detail', 'Detail', 'Detail', 'Detail', 'Detail', 'ReportFooter', 'PageFooter'],
      roles: boxes.map((_, k) => (k === 0 ? 'title' : 'value')),
    };
    const settled = settleRecords(boxes, raw);
    expect(settled.bands.slice(0, 3)).toEqual(['PageHeader', 'PageHeader', 'Detail']);
    expect([1, 2, 3].map((k) => settled.roles[k])).toEqual(['caption', 'caption', 'caption']);
    // A first record with digits in it is not a heading.
    const records = settleRecords(boxes, { ...raw, bands: ['PageHeader', 'PageHeader', 'Detail', 'Detail', 'Detail', 'Detail', 'ReportFooter', 'PageFooter'] });
    expect(records.bands[2]).toBe('Detail');
  });
});

describe('a report from a page OCR read', () => {
  const model = JSON.parse(readFileSync('assets/model/boxReader.json', 'utf8')) as BoxReaderModel;
  // The page above as OCR returns it, read at 100 dpi: a pixel is a hundredth of an inch.
  const lineOfWords = (bs: ReadBox[]): OcrLine => {
    const words: OcrWord[] = bs.map((b) => ({ text: b.text, confidence: 95, box: { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } }));
    const box = { x0: Math.min(...bs.map((b) => b.x)), y0: Math.min(...bs.map((b) => b.y)), x1: Math.max(...bs.map((b) => b.x + b.w)), y1: Math.max(...bs.map((b) => b.y + b.h)) };
    return { text: bs.map((b) => b.text).join(' '), confidence: 95, box, words };
  };
  const ocr: OcrPage = { width: 827, height: 1169, dpi: 100, lines: linesOf(boxes).map((l) => lineOfWords(l.boxes.map((k) => boxes[k]))) };
  const read = (o: OcrPage) => [{ meta: { uploadId: 'u1', file: 'sales.png' }, read: { ocr: o, flagged: 0, lines: o.lines.length } }];

  it("puts the texts OCR read in bands, records bound to fields, as Forma's box reader", () => {
    const built = buildWithReader(read(ocr), model, 'A4')!;
    expect(built.skeleton.bands.map((b) => b.kind)).toContain('Detail');
    expect(built.repxContent).toMatch(/ControlType="DetailBand"[^>]*><Controls>/);
    expect(built.repxContent).toMatch(/Expression="\[\w+\]"/);
    expect(built.markdown).toContain("Read from the picture by Forma's box reader, from the text OCR read: A4");
    expect(built.read).toBeGreaterThan(0);
  });

  it('builds nothing from a page with no text', () => {
    expect(buildWithReader(read({ ...ocr, lines: [] }), model, 'A4')).toBeNull();
    expect(buildWithReader([], model, 'A4')).toBeNull();
  });
});

describe('loading it', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a reader trained on other features, and tries again next time', async () => {
    const model = JSON.parse(readFileSync('assets/model/boxReader.json', 'utf8')) as BoxReaderModel;
    const answer = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const fetch = vi.fn().mockReturnValueOnce(answer({ ...model, lineFeatures: ['top'] })).mockReturnValueOnce(answer(model));
    vi.stubGlobal('fetch', fetch);
    await expect(loadBoxReader()).rejects.toThrow(/not one this version can read/);
    await expect(loadBoxReader()).resolves.toMatchObject({ version: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
