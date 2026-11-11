import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReportSkeleton } from './reportSkeleton';
import {
  VISION_INSTRUCTION,
  fixedPlaces,
  fontToken,
  perturbSkeleton,
  publicFontsOnly,
  readPage,
  scorePlaces,
  scoreSkeleton,
  skeletonToText,
  strayWords,
  textToSkeleton,
  withPrintedHeights,
} from './skeletonText';

/** A seeded generator, so a variant is the same on every run. */
const seeded = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const arial = (size: number, bold = false, italic = false) => ({ family: 'Arial', size, bold, italic });

/** Every feature the format carries: a table with rows, no font, a spaced family, a group, landscape. */
const skeleton: ReportSkeleton = {
  paper: 'A4',
  landscape: true,
  width: 1169,
  height: 827,
  margins: { top: 50, bottom: 40, left: 60, right: 60 },
  bands: [
    { kind: 'TopMargin', height: 50, groupFields: 0, controls: [] },
    {
      kind: 'PageHeader',
      height: 120,
      groupFields: 0,
      controls: [
        { kind: 'label', role: 'title', x: 0, y: 10, w: 500, h: 40, font: arial(14, true), align: 'center', borders: 0, chars: 18 },
        { kind: 'picture', role: 'decoration', x: 900, y: 0, w: 100, h: 60, font: null, align: 'left', borders: 0, chars: 0 },
        {
          kind: 'table',
          role: 'value',
          x: 0,
          y: 80,
          w: 1049,
          h: 25,
          font: { family: 'Times New Roman', size: 9.75, bold: false, italic: true },
          align: 'left',
          borders: 15,
          chars: 0,
          rows: [
            [
              { weight: 1, role: 'caption', align: 'left', chars: 4, font: arial(9, true) },
              { weight: 2.5, role: 'caption', align: 'right', chars: 11, font: null },
            ],
            [],
          ],
        },
      ],
    },
    { kind: 'GroupHeader', height: 30, groupFields: 2, controls: [{ kind: 'line', role: 'decoration', x: 0, y: 28, w: 1049, h: 2, font: null, align: 'left', borders: 0, chars: 0 }] },
    { kind: 'Detail', height: 25, groupFields: 0, controls: [{ kind: 'label', role: 'total', x: 900, y: 0, w: 149, h: 25, font: arial(8, false, true), align: 'right', borders: 4, chars: 0 }] },
  ],
};

describe('skeletonToText and textToSkeleton', () => {
  it('reads back exactly what it wrote', () => {
    const text = skeletonToText(skeleton);
    expect(textToSkeleton(text)).toEqual({ skeleton, problems: [] });
  });

  it('writes one line per band, control and table row, in fixed positions', () => {
    expect(skeletonToText(skeleton).split('\n').slice(0, 7)).toEqual([
      'page A4 landscape 1169 827 50 40 60 60',
      'band TopMargin 50 0',
      'band PageHeader 120 0',
      'label title 0 10 500 40 Arial:14b c 0 18',
      'picture decoration 900 0 100 60 - l 0 0',
      'table value 0 80 1049 25 Times_New_Roman:9.75i l 15 0',
      'row caption 1 Arial:9b l 4 | caption 2.5 - r 11',
    ]);
  });

  it('rounds places to whole hundredths of an inch and sizes to two decimals', () => {
    const k: ReportSkeleton = {
      ...skeleton,
      width: 826.6,
      bands: [{ kind: 'Detail', height: 24.5, groupFields: 0, controls: [{ ...skeleton.bands[3].controls[0], x: 10.4, font: arial(9.756) }] }],
    };
    const back = textToSkeleton(skeletonToText(k)).skeleton!;
    expect(back.width).toBe(827);
    expect(back.bands[0].height).toBe(25);
    expect(back.bands[0].controls[0].x).toBe(10);
    expect(back.bands[0].controls[0].font!.size).toBe(9.76);
  });

  it('skips what it cannot read and says which line, rather than throwing', () => {
    const answer = [
      '```',
      'page A4 portrait 827 1169 50 50 60 60',
      'label caption 0 0 10 10 Arial:9 l 0 3',
      'band Detail 25 0',
      'label caption 0 0 10 10 Arial:9 x 0 3',
      'row caption 1 Arial:9 l 4',
      'wobble',
      'label value 0 0 100 25 Arial:9 r 0 0',
      '```',
    ].join('\n');
    const { skeleton: k, problems } = textToSkeleton(answer);
    expect(problems).toEqual([
      'line 3: a control before any band',
      'line 5: a control needs a kind, a role, four numbers, a font, an alignment, borders and a length',
      'line 6: a row line must follow a table',
      'line 7: not understood',
    ]);
    expect(k!.bands).toHaveLength(1);
    expect(k!.bands[0].controls).toHaveLength(1);
    expect(k!.bands[0].controls[0].role).toBe('value');
  });

  it('skips a row whole when one of its cells is malformed', () => {
    const { skeleton: k, problems } = textToSkeleton(
      ['page A4 portrait 827 1169 50 50 60 60', 'band Detail 25 0', 'table value 0 0 700 25 - l 0 0', 'row value 1 - l 0 | value two - l 0'].join('\n'),
    );
    expect(problems).toEqual(['line 4: a cell needs a role, a weight, a font, an alignment and a length']);
    expect(k!.bands[0].controls[0].rows).toEqual([]);
  });

  it('refuses an answer with no page line, since it has no page to put bands on', () => {
    expect(textToSkeleton('band Detail 25 0')).toEqual({ skeleton: null, problems: ['no page line'] });
  });
});

describe('withPrintedHeights', () => {
  it('makes a band drawn shorter than its controls as tall as they reach, as DevExpress prints it', () => {
    const label = skeleton.bands[3].controls[0];
    const k: ReportSkeleton = {
      ...skeleton,
      bands: [
        { kind: 'Detail', height: 3.7, groupFields: 0, controls: [{ ...label, y: 0, h: 17.53 }, { ...label, y: 2, h: 10 }] },
        { kind: 'PageHeader', height: 120, groupFields: 0, controls: [{ ...label, y: 10, h: 40 }] },
        { kind: 'TopMargin', height: 50, groupFields: 0, controls: [] },
      ],
    };
    expect(withPrintedHeights(k).bands.map((b) => b.height)).toEqual([17.53, 120, 50]);
  });
});

describe('perturbSkeleton', () => {
  const variants = Array.from({ length: 20 }, (_, i) => perturbSkeleton(skeleton, seeded(i + 1)));

  it('keeps the structure: the same paper and bands, with no control added', () => {
    for (const v of variants) {
      expect(v.paper).toBe(skeleton.paper);
      expect(v.bands.map((b) => b.kind)).toEqual(skeleton.bands.map((b) => b.kind));
      v.bands.forEach((b, i) => expect(b.controls.length).toBeLessThanOrEqual(skeleton.bands[i].controls.length));
    }
  });

  it('moves things, so its text differs from the original and from other variants', () => {
    const texts = new Set(variants.map(skeletonToText));
    expect(texts.has(skeletonToText(skeleton))).toBe(false);
    expect(texts.size).toBe(variants.length);
  });

  it('keeps every control inside its band and the printable width, and adds no word', () => {
    for (const v of variants) {
      const printable = v.width - v.margins.left - v.margins.right;
      for (const b of v.bands) {
        for (const c of b.controls) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x + c.w).toBeLessThanOrEqual(printable);
          expect(c.y + c.h).toBeLessThanOrEqual(b.height);
        }
      }
      expect(strayWords(skeletonToText(v))).toEqual([]);
    }
  });

  it('is the same for the same seed', () => {
    expect(perturbSkeleton(skeleton, seeded(7))).toEqual(perturbSkeleton(skeleton, seeded(7)));
  });
});

describe('VISION_INSTRUCTION', () => {
  it('is the sentence the training script asks the model, word for word', () => {
    const script = readFileSync('scripts/model/kaggle/train_vision.py', 'utf8');
    const literal = /^INSTRUCTION = \(([\s\S]*?)\)$/m.exec(script)![1];
    const asked = [...literal.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
    expect(asked).toBe(VISION_INSTRUCTION);
  });
});

describe('scoreSkeleton', () => {
  it('scores the right answer as perfect', () => {
    expect(scoreSkeleton(skeleton, skeleton)).toEqual({
      parsed: true,
      paper: true,
      bands: { predicted: 4, expected: 4, matched: 4 },
      controls: { predicted: 5, expected: 5, matched: 5, kind: 5, role: 5 },
    });
  });

  it('pairs controls by place within a band, and counts a wrong kind or role among the pairs', () => {
    const moved: ReportSkeleton = {
      ...skeleton,
      paper: 'Letter',
      bands: skeleton.bands.map((b) =>
        b.kind === 'PageHeader'
          ? { ...b, controls: [{ ...b.controls[0], role: 'caption' }, { ...b.controls[1], kind: 'shape' }, { ...b.controls[2], y: 400 }] }
          : b,
      ),
    };
    const score = scoreSkeleton(moved, skeleton);
    expect(score.paper).toBe(false);
    expect(score.controls).toEqual({ predicted: 5, expected: 5, matched: 4, kind: 3, role: 3 });
  });

  it('scores an answer with no page line as nothing found', () => {
    expect(scoreSkeleton(null, skeleton)).toMatchObject({ parsed: false, controls: { predicted: 0, expected: 5, matched: 0 } });
  });
});

describe('fixedPlaces and scorePlaces', () => {
  /** A title and a heading row at the top, a record, page information at the foot. */
  const page: ReportSkeleton = {
    paper: 'A4',
    landscape: false,
    width: 827,
    height: 1169,
    margins: { top: 50, bottom: 40, left: 40, right: 40 },
    bands: [
      { kind: 'TopMargin', height: 50, groupFields: 0, controls: [] },
      { kind: 'ReportHeader', height: 60, groupFields: 0, controls: [{ kind: 'label', role: 'title', x: 0, y: 10, w: 400, h: 30, font: arial(14, true), align: 'left', borders: 0, chars: 10 }] },
      {
        kind: 'PageHeader',
        height: 20,
        groupFields: 0,
        controls: [
          {
            kind: 'table',
            role: 'caption',
            x: 0,
            y: 0,
            w: 600,
            h: 20,
            font: arial(9, true),
            align: 'left',
            borders: 0,
            chars: 0,
            rows: [
              [
                { weight: 1, role: 'caption', align: 'left', chars: 5, font: null },
                { weight: 2, role: 'caption', align: 'left', chars: 0, font: null },
              ],
            ],
          },
        ],
      },
      { kind: 'Detail', height: 20, groupFields: 0, controls: [{ kind: 'label', role: 'value', x: 0, y: 0, w: 200, h: 20, font: arial(8), align: 'left', borders: 0, chars: 0 }] },
      { kind: 'PageFooter', height: 20, groupFields: 0, controls: [{ kind: 'pageInfo', role: 'pageInfo', x: 500, y: 0, w: 200, h: 20, font: arial(7), align: 'right', borders: 0, chars: 0 }] },
      { kind: 'BottomMargin', height: 40, groupFields: 0, controls: [] },
    ],
  };

  it("lays out the bands at fixed places as render.py draws them, and leaves out the records", () => {
    const { places, regions } = fixedPlaces(page);
    expect(places).toEqual([
      { x: 40, y: 60, w: 400, h: 30, text: true },
      { x: 40, y: 110, w: 200, h: 20, text: true },
      // A caption with no characters prints nothing.
      { x: 240, y: 110, w: 400, h: 20, text: false },
      // The page footer sits on the bottom margin: 1169 - 40 - 20.
      { x: 540, y: 1109, w: 200, h: 20, text: true },
    ]);
    expect(regions).toEqual([
      { top: 0, bottom: 130 },
      { top: 1109, bottom: 1169 },
    ]);
  });

  it('counts a box right at half overlap, text found where something was read inside it, and ignores readings among the records', () => {
    const { places, regions } = fixedPlaces(page);
    expect(scorePlaces(places, places, regions)).toEqual({ expected: 3, predicted: 3, matched: 3, found: 3 });
    // OCR boxes the ink: inside each place, far smaller than it.
    const ink = places.filter((p) => p.text).map((p) => ({ x: p.x + 4, y: p.y + 6, w: 40, h: 8, text: true }));
    const inDetail = { x: 40, y: 600, w: 200, h: 20, text: true };
    expect(scorePlaces([...ink, inDetail], places, regions)).toEqual({ expected: 3, predicted: 3, matched: 0, found: 3 });
  });
});

describe('fontToken', () => {
  it('writes spaces as underscores, and bold and italic after the size', () => {
    expect(fontToken({ family: 'Segoe UI', size: 8.25, bold: true, italic: true })).toBe('Segoe_UI:8.25bi');
    expect(fontToken(null)).toBe('-');
  });
});

describe('publicFontsOnly and strayWords', () => {
  const withPrivateFont: ReportSkeleton = {
    ...skeleton,
    bands: [
      {
        kind: 'Detail',
        height: 25,
        groupFields: 0,
        controls: [
          { ...skeleton.bands[1].controls[0], font: { family: 'Acme Corporate Sans', size: 9, bold: false, italic: false } },
          { ...skeleton.bands[1].controls[2], rows: [[{ weight: 1, role: 'value', align: 'left', chars: 0, font: { family: 'Acme Mono', size: 8, bold: false, italic: false } }]] },
        ],
      },
    ],
  };

  it('finds a font name that is not a public typeface, since it is a word of the report', () => {
    expect(strayWords(skeletonToText(withPrivateFont))).toEqual(['Acme_Corporate_Sans:9', 'Acme_Mono:8']);
  });

  it('replaces every such font with Arial, in labels and table cells alike, and counts them', () => {
    const { skeleton: k, replaced } = publicFontsOnly(withPrivateFont);
    expect(replaced).toBe(2);
    expect(strayWords(skeletonToText(k))).toEqual([]);
    expect(k.bands[0].controls[0].font!.family).toBe('Arial');
    expect(k.bands[0].controls[1].font!.family).toBe('Times New Roman');
  });

  it('passes the text of an ordinary skeleton', () => {
    expect(strayWords(skeletonToText(skeleton))).toEqual([]);
  });
});

// The full audit (2026-11-11, PL-25): one unexpected word no longer throws the corrected draft away.
describe('a page line read tolerantly', () => {
  const tokens = (line: string) => line.split(/\s+/);

  it('reads the line as written', () => {
    expect(readPage(tokens('page A4 portrait 827 1169 50 50 40 40'))).toEqual({ paper: 'A4', landscape: false, width: 827, height: 1169, margins: { top: 50, bottom: 50, left: 40, right: 40 } });
  });

  it('reads the orientation and the paper in any case, and a paper it does not list as Custom', () => {
    expect(readPage(tokens('page letter Landscape 1100 850 75 75 75 75'))).toMatchObject({ paper: 'Letter', landscape: true });
    expect(readPage(tokens('page Tabloid PORTRAIT 1100 1700 50 50 50 50'))).toMatchObject({ paper: 'Custom', landscape: false, width: 1100, height: 1700 });
  });

  it('takes margins left off the end as 0', () => {
    expect(readPage(tokens('page Letter portrait 850 1100 75 60'))?.margins).toEqual({ top: 75, bottom: 60, left: 0, right: 0 });
    expect(readPage(tokens('page Letter portrait 850 1100 75 60 50'))?.margins).toEqual({ top: 75, bottom: 60, left: 50, right: 0 });
  });

  it('still refuses a line with no orientation, no size, or words for numbers', () => {
    expect(readPage(tokens('page Letter 850 1100 75 75 75 75'))).toBeNull();
    expect(readPage(tokens('page Letter portrait 850 1100'))).toBeNull();
    expect(readPage(tokens('page Letter portrait 850 tall 75 75 75 75'))).toBeNull();
    expect(readPage(tokens('band Letter portrait 850 1100 75 75 75 75'))).toBeNull();
  });
});
