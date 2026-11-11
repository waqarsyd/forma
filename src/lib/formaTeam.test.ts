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
  // The full audit (2026-11-10), the owner's rule: who did what is not said; the reply is the result.
  it('names nobody, and in mock mode alone says a canned report stood in (agent audit item 96)', () => {
    expect(teamLine()).toBe('');
    expect(teamLine(false)).toBe('');
    const line = teamLine(true);
    expect(line).toBe('Mock mode is on, so a canned report stood in for the AI.');
    expect(line).not.toContain('Gemini');
  });

  it('says why the AI did not answer in a few plain words', () => {
    expect(failureReason('429 RESOURCE_EXHAUSTED: You exceeded your current quota.')).toBe('its free limit is used up for now');
    expect(failureReason('TypeError: Failed to fetch')).toBe('it could not be reached');
    expect(failureReason('503 The model is overloaded. Try later.')).toBe('it is busy right now');
    // Anything else is no answer, never the provider's own sentence (2026-11-11, CV-07).
    expect(failureReason('The model returned no report. Something else.')).toBe('it gave no answer');
    expect(failureReason('The local AI spent its answer on reasoning and wrote none.')).toBe('it gave no answer');
    // Agent audit item 15: the words a local model's failure and the classified ones use.
    expect(failureReason('You are offline. Forma needs a connection.')).toBe('you are offline');
    expect(failureReason("Google's servers are busy and could not take this request")).toBe('it is busy right now');
    expect(failureReason('Forma could not reach the local AI at http://localhost:11434/v1.')).toBe('it could not be reached');
    expect(failureReason("The local AI read only 2,048 of about 10,000 tokens of the request: qwen3's context window is too small")).toBe('the request was too long for it');
    expect(failureReason('400 API key not valid. Please pass a valid API key.')).toBe('it did not accept the key');
  });

  // The full audit (2026-11-11, CV-07): a quicker version, in the user's terms, naming no part of Forma.
  it('hands over a quicker version, or a first draft of a description, naming no part of Forma', () => {
    expect(fallbackReply('Gemini', '429 quota')).toBe(
      "Gemini couldn't take this one (its free limit is used up for now), so here is a quicker version of the page. " +
        'Check the figures and fonts against your source, and send the request again later for the full design.',
    );
    expect(fallbackReply('OpenRouter', 'Failed to fetch')).toContain("OpenRouter couldn't take this one (it could not be reached)");
    expect(fallbackReply('Gemini', '503', true)).toBe(
      "Gemini couldn't take this one (it is busy right now), so this is a first draft from your description. Send it again later to have it designed in full.",
    );
    const errors = ['429', '503', 'Failed to fetch', 'offline', 'context window is too small', 'spent it reasoning and wrote none', 'The model returned no report.', 'Something odd'];
    for (const e of errors) {
      for (const described of [false, true]) {
        expect(fallbackReply('Gemini', e, described)).not.toMatch(/own draft|OCR|box reader|vision model|context window|reasoning|the model/i);
      }
    }
  });
});
