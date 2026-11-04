/**
 * The boxes design for Forma's vision model (2026-11-04): the question it is
 * asked, its answer read back, made a skeleton on the boxes' own places, and
 * scored box by box.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BOX_INSTRUCTION, boxAnswerToSkeleton, boxesOfPrompt, boxPrompt, orderBoxes, parseBoxAnswer, scoreBoxAnswer } from './boxText';

const answer = [
  'page A4 portrait 827 1169 100 7 100 100',
  'band TopMargin 0 100',
  'band PageHeader 104 169',
  '1 caption',
  '2 value',
  'band Detail 273 18',
  '3 value',
  'band ReportFooter 290 31',
  '4 total',
].join('\n');

describe('the question', () => {
  it('is the sentence render.py asks the model, word for word', () => {
    const py = readFileSync('scripts/model/render.py', 'utf8');
    const m = /BOX_INSTRUCTION = \(([\s\S]*?)\)\n/.exec(py)!;
    const said = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('');
    expect(said).toBe(BOX_INSTRUCTION);
  });

  it('numbers the boxes in reading order and reads them back', () => {
    const boxes = orderBoxes([
      { x: 500, y: 133, w: 42, h: 9 },
      { x: 109, y: 133, w: 60, h: 7 },
      { x: 109, y: 154.4, w: 76, h: 10 },
    ]);
    const prompt = boxPrompt(boxes);
    expect(prompt.split('\n').slice(1)).toEqual(['1 109 133 60 7', '2 500 133 42 9', '3 109 154 76 10']);
    expect(boxesOfPrompt(prompt).get(2)).toEqual({ x: 500, y: 133, w: 42, h: 9 });
  });
});

describe('the answer', () => {
  it('reads the page, the bands and their boxes, and skips what it cannot read', () => {
    const read = parseBoxAnswer(`${answer}\nband Nowhere 1 2\n9 shouting`);
    expect(read.page?.paper).toBe('A4');
    expect(read.bands.map((b) => `${b.kind} ${b.top} ${b.height} ${b.boxes.length}`)).toEqual(['TopMargin 0 100 0', 'PageHeader 104 169 2', 'Detail 273 18 1', 'ReportFooter 290 31 1']);
    expect(read.problems).toHaveLength(2);
  });

  it('makes a skeleton with each box at its own place in its band', () => {
    const boxes = new Map([
      [1, { x: 109, y: 133, w: 60, h: 7 }],
      [2, { x: 516, y: 154, w: 35, h: 8 }],
      [3, { x: 109, y: 280, w: 40, h: 9 }],
    ]);
    const k = boxAnswerToSkeleton(parseBoxAnswer(answer), boxes)!;
    expect(k.margins.left).toBe(100);
    const header = k.bands.find((b) => b.kind === 'PageHeader')!;
    expect(header.controls.map((c) => [c.role, c.x, c.y, c.w, c.h])).toEqual([
      ['caption', 9, 29, 60, 7],
      ['value', 416, 50, 35, 8],
    ]);
    // A caption read off the page has text: its length comes from its width, so it prints.
    expect(header.controls.map((c) => c.chars)).toEqual([9, 0]);
    expect(k.bands.find((b) => b.kind === 'Detail')!.controls[0]).toMatchObject({ x: 9, y: 7 });
    // Box 4 is not among the boxes, so the footer has no control.
    expect(k.bands.find((b) => b.kind === 'ReportFooter')!.controls).toHaveLength(0);
    expect(boxAnswerToSkeleton(parseBoxAnswer('band Detail 0 10'), boxes)).toBeNull();
  });

  it('scores the boxes listed, their bands and roles, and the bands', () => {
    const wrong = answer.replace('2 value', '2 caption').replace('band ReportFooter 290 31\n4 total', 'band PageFooter 290 31\n4 total\n7 value');
    const s = scoreBoxAnswer(parseBoxAnswer(wrong), parseBoxAnswer(answer));
    expect(s).toEqual({ expected: 4, predicted: 5, listed: 4, band: 3, role: 2, bands: { expected: 4, predicted: 4, matched: 3 } });
  });
});
