/**
 * Forma's team (2026-11-03): what each part of Forma tells the AI that
 * designs, who the reply says took part, and the reply when Forma's own draft
 * stands in for an AI that could not answer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRIEF_MAX_ELEMENTS, draftBrief, failureReason, fallbackReply, houseStyleBrief, teamLine } from './formaTeam';
import type { FormaModel, HouseStyle } from './formaModel';
import type { ReportSkeleton } from './reportSkeleton';
import type { ReportElement, ReportLayout } from './reportTypes';

const skeleton: ReportSkeleton = {
  paper: 'A4',
  landscape: false,
  width: 827,
  height: 1169,
  margins: { top: 50, bottom: 40, left: 40, right: 30 },
  bands: [],
};

const element = (e: Partial<ReportElement>): ReportElement => ({ id: 'e', type: 'label', content: '', x: 0, y: 0, width: 100, height: 20, ...e });

/** What skeletonToDesign builds, in hundredths of an inch: a title, a heading row, a bound value, a total. */
const layout: ReportLayout = {
  title: 'Invoice',
  pageWidth: 827,
  sections: [
    {
      id: 's1',
      name: 'Report header',
      type: 'header',
      height: 60,
      elements: [element({ content: 'TAX INVOICE', x: 200, y: 5, width: 400, height: 30, fontSize: 22.22, bold: true, textAlign: 'center' })],
    },
    {
      id: 's2',
      name: 'Page header',
      type: 'header',
      height: 25,
      elements: [element({ type: 'table', rows: [{ cells: [{ content: 'Item' }, { content: 'Amount' }] }] })],
    },
    {
      id: 's3',
      name: 'Detail',
      type: 'detail',
      height: 20,
      elements: [element({ content: '[Amount]', x: 600, width: 120, textAlign: 'right' }), element({ type: 'line', y: 19, width: 750, height: 1 })],
    },
    { id: 's4', name: 'Report footer', type: 'footer', height: 25, elements: [element({ content: 'sum [Amount]', x: 600, width: 120 })] },
    { id: 's5', name: 'Page footer', type: 'footer', height: 20, elements: [] },
  ],
};

describe('draftBrief', () => {
  it("tells the AI the vision model's draft, with OCR's words in its boxes, and that the image wins", () => {
    const brief = draftBrief(skeleton, layout, 'HundredthsOfAnInch');
    expect(brief).toMatch(/^FORMA'S OWN DRAFT OF THIS PAGE/);
    expect(brief).toContain('wherever it disagrees with the image, the image is right');
    expect(brief).toContain('Paper: A4 portrait; margins top 50, bottom 40, left 40, right 30.');
    expect(brief).toContain('- Report header, height 60:');
    expect(brief).toContain('label at 200,5 size 400x30, Arial 16pt bold, centred: "TAX INVOICE"');
    expect(brief).toContain('table at 0,0 size 100x20, 1 row(s) of 2 cells; first row: "Item" | "Amount"');
    expect(brief).toContain('label at 600,0 size 120x20, right: value bound to [Amount]');
    expect(brief).toContain('label at 600,0 size 120x20: total, sum [Amount]');
    expect(brief).toContain('line at 0,19 size 750x1');
    expect(brief).toContain('- Page footer, height 20:\n  (nothing drawn)');
  });

  it("says when Forma's box reader, not the vision model, read the layout", () => {
    const brief = draftBrief(skeleton, layout, 'HundredthsOfAnInch', 'reader');
    expect(brief).toMatch(/^FORMA'S OWN DRAFT OF THIS PAGE\. OCR read its words and Forma's box reader put each in its band and gave it its role\. /);
    expect(brief).not.toContain('vision model');
    expect(brief).toContain('- Report header, height 60:');
  });

  it("gives every length in the report's own unit", () => {
    const brief = draftBrief(skeleton, layout, 'TenthsOfAMillimeter');
    expect(brief).toContain('margins top 127, bottom 101.6, left 101.6, right 76.2');
    expect(brief).toContain('label at 508,12.7 size 1016x76.2');
    // A font is in points whatever the unit.
    expect(brief).toContain('Arial 16pt bold');
  });

  it('cuts a long text and lists at most so many boxes', () => {
    const many: ReportLayout = {
      ...layout,
      sections: [{ id: 's', name: 'Detail', type: 'detail', height: 20, elements: Array.from({ length: BRIEF_MAX_ELEMENTS + 5 }, () => element({ content: 'x'.repeat(200) })) }],
    };
    const brief = draftBrief(skeleton, many, 'HundredthsOfAnInch');
    expect(brief).toContain(`"${'x'.repeat(59)}…"`);
    expect(brief.split('\n').filter((l) => l.startsWith('  - '))).toHaveLength(BRIEF_MAX_ELEMENTS);
    expect(brief).toContain('(5 more box(es) not listed.)');
  });
});

describe('houseStyleBrief', () => {
  const style: HouseStyle = {
    fonts: [{ family: 'Arial', share: 0.9 }],
    roles: { title: { family: 'Arial', size: 14, bold: 0.9 }, caption: { family: 'Arial', size: 9, bold: 0.7 }, value: { family: 'Tahoma', size: 8, bold: 0.1 } },
    papers: [{ paper: 'A4', landscape: false, share: 0.8 }],
    margins: { A4: { top: 50, bottom: 50, left: 40, right: 40 } },
    bands: {},
    rowHeight: 18,
  };

  it('tells the paper, margins, fonts by role and a record line, as defaults the request overrules', () => {
    const brief = houseStyleBrief(style, 359, 'HundredthsOfAnInch');
    expect(brief).toMatch(/^HOUSE STYLE, learned by Forma's own model from 359 reports\. Use it wherever the description and the user's preferences say nothing/);
    expect(brief).toContain('- Paper: A4 portrait; margins top 50, bottom 50, left 40, right 40.');
    expect(brief).toContain('- Fonts: Arial throughout; titles 14pt bold, captions and column headings 9pt bold, values Tahoma 8pt.');
    expect(brief).toContain("- A record's line is 18 tall.");
  });

  it('says nothing when the style holds nothing', () => {
    expect(houseStyleBrief({ fonts: [], roles: {}, papers: [], margins: {}, bands: {}, rowHeight: 0 }, 0, 'HundredthsOfAnInch')).toBe('');
  });

  it("reads the shipped model's style", () => {
    const model = JSON.parse(readFileSync('assets/model/formaModel.json', 'utf8')) as FormaModel;
    const brief = houseStyleBrief(model.style, model.reports, 'HundredthsOfAnInch');
    expect(brief).toContain(`from ${model.reports} reports`);
    expect(brief).toMatch(/- Paper: \w+ (portrait|landscape)/);
    expect(brief).toMatch(/- Fonts: /);
  });
});

describe('the replies', () => {
  it('names who took part, in the order they acted', () => {
    expect(teamLine(['ocr', 'vision', 'memory', 'ai', 'checks'], 'Gemini')).toBe(
      "OCR read the words, Forma's vision model read the layout, your remembered preferences were applied, Gemini designed the report and Forma checked and repaired the result.",
    );
    expect(teamLine(['house', 'ai', 'checks'], 'Local AI')).toBe("Forma's own model gave the house style, Local AI designed the report and Forma checked and repaired the result.");
    expect(teamLine(['ai'], 'Gemini')).toBe('');
    expect(teamLine(['ocr', 'reader', 'ai', 'checks'], 'Gemini')).toBe(
      "OCR read the words, Forma's box reader put each in its band, Gemini designed the report and Forma checked and repaired the result.",
    );
  });

  it('says the AI corrected Forma\'s draft and Forma built the report, when it did (2026-11-05)', () => {
    expect(teamLine(['ocr', 'reader', 'corrector', 'builder'], 'Gemini')).toBe(
      "OCR read the words, Forma's box reader put each in its band, Gemini corrected Forma's draft and Forma built the report from it and checked it.",
    );
  });

  // Agent audit item 96: mock mode asked no AI, and credited Gemini anyway.
  it('says the canned report stood in for the AI in mock mode, and names no AI', () => {
    const line = teamLine(['ocr', 'reader', 'ai', 'checks'], 'Gemini', true);
    expect(line).toBe("OCR read the words, Forma's box reader put each in its band, the canned mock report stood in for an AI and Forma checked and repaired the result.");
    expect(line).not.toContain('Gemini');
  });

  it('says why the AI did not answer in a few words, and what the draft was made from', () => {
    expect(failureReason('429 RESOURCE_EXHAUSTED: You exceeded your current quota.')).toBe('its free quota is used up for now');
    expect(failureReason('TypeError: Failed to fetch')).toBe('it could not be reached');
    expect(failureReason('503 The model is overloaded. Try later.')).toBe('it is overloaded right now');
    expect(failureReason('The model returned no report. Something else.')).toBe('The model returned no report.');
    // Agent audit item 15: the words a local model's failure and the classified ones use.
    expect(failureReason('You are offline. Forma needs a connection.')).toBe('you are offline');
    expect(failureReason("Google's servers are busy and could not take this request")).toBe('it is overloaded right now');
    expect(failureReason('Forma could not reach the local AI at http://localhost:11434/v1.')).toBe('it could not be reached');
    expect(failureReason("The local AI read only 2,048 of about 10,000 tokens of the request: qwen3's context window is too small")).toBe('its context window is too small for the request');
    expect(fallbackReply('Gemini', '429 quota', 'vision')).toBe(
      "Gemini could not answer (its free quota is used up for now), so Forma built this draft without it, from Forma's vision model and the text OCR read. " +
        'Send the request again when Gemini is available to have it designed in full.',
    );
    expect(fallbackReply('OpenRouter', 'Failed to fetch', 'offline')).toContain("from Forma's own model.");
    expect(fallbackReply('Gemini', '503', 'reader')).toContain("from the text OCR read, put in bands by Forma's box reader.");
  });
});
