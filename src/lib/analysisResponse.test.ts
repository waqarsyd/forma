/**
 * Turning what the model returned into a report, or into a message that says
 * why it isn't one.
 *
 * This is the branch that decides what a user sees when generation goes wrong,
 * and it was the hardest thing in the codebase to reach: it lived at the bottom
 * of `analyzeReportDesign`, after the streaming loop, so exercising it meant a
 * real key, a real request, and a model that could be persuaded to fail in the
 * right way. `geminiService.ts` records that the truncation case was verified
 * "over CDP by fulfilling the stream with 62% of a valid payload" — a genuine
 * and careful piece of work that could only ever be done once, by hand.
 *
 * The distinction it draws is the whole point. A truncated body is still a body:
 * the model wrote most of the report and was cut off mid-string, and the JSON is
 * unparseable exactly as it would be for nonsense. Only `finishReason` separates
 * ran-out-of-room from garbage, and getting it wrong is wrong twice over — it
 * blames the model for output that was fine as far as it got, and it tells the
 * user to try again, which for the same input fails the same way every time.
 *
 * Fixtures, no network, no key, no mocking.
 */
import { describe, it, expect } from 'vitest';
import { parseAnalysisResponse } from './analysisResponse';

/** The shape observed from a real generation on 2026-08-27. */
const VALID = JSON.stringify({
  markdown: '# Quarterly Invoice\n\nA header band with the title, a detail band, and a page footer.',
  layout: {
    pageWidth: 850,
    sections: [
      { type: 'header', elements: [{ id: 'title', type: 'label', content: 'INVOICE', x: 20, y: 20, width: 400, height: 30 }] },
      { type: 'detail', elements: [{ id: 'row', type: 'label', content: 'Item', x: 20, y: 60, width: 400, height: 20 }] },
      { type: 'footer', elements: [] },
    ],
  },
  repxContent: '<XtraReportsLayoutSerializer Ref="0" ReportUnit="HundredthsOfAnInch" PageWidth="850"><Bands /></XtraReportsLayoutSerializer>',
});

/** The same payload cut off mid-string, as a MAX_TOKENS stop produces. */
const TRUNCATED = VALID.slice(0, Math.floor(VALID.length * 0.62));

describe('parseAnalysisResponse — success', () => {
  it('returns the parsed report', () => {
    const parsed = parseAnalysisResponse(VALID, undefined);
    expect(parsed.layout.sections).toHaveLength(3);
    expect(parsed.repxContent).toContain('XtraReportsLayoutSerializer');
    expect(parsed.markdown).toContain('Quarterly Invoice');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseAnalysisResponse(`\n\n  ${VALID}\n `, undefined).layout.sections).toHaveLength(3);
  });

  it('accepts a report whose finishReason is the ordinary STOP', () => {
    expect(parseAnalysisResponse(VALID, 'STOP').layout.sections).toHaveLength(3);
  });
});

describe('parseAnalysisResponse — truncation is not malformity', () => {
  it('says the report was cut off, not that the model returned nonsense', () => {
    // The regression this file exists for. Before 2026-08-26 this produced
    // "The AI returned a malformed report. Try generating again."
    expect(() => parseAnalysisResponse(TRUNCATED, 'MAX_TOKENS')).toThrow(/cut off/i);
  });

  it('does not tell the user to simply try again, because that would fail identically', () => {
    let message = '';
    try { parseAnalysisResponse(TRUNCATED, 'MAX_TOKENS'); } catch (e: any) { message = e.message; }
    expect(message).toMatch(/simpler|fewer|split/i);
    expect(message).toMatch(/same limit|same way/i);
  });

  it('reports an empty body with MAX_TOKENS as too large, not as empty', () => {
    expect(() => parseAnalysisResponse('', 'MAX_TOKENS')).toThrow(/too large/i);
  });

  it('still calls genuinely unparseable output malformed', () => {
    // No finishReason to excuse it — this really is nonsense.
    expect(() => parseAnalysisResponse('not json at all {{{', undefined)).toThrow(/malformed/i);
  });

  it('treats a truncated body with no finishReason as malformed', () => {
    // Honest: without the signal there is nothing to distinguish the two, and
    // guessing from the shape of the text would be worse than saying so.
    expect(() => parseAnalysisResponse(TRUNCATED, undefined)).toThrow(/malformed/i);
  });
});

describe('parseAnalysisResponse — blocked', () => {
  for (const reason of ['SAFETY', 'PROHIBITED_CONTENT']) {
    it(`explains a ${reason} stop on an empty body`, () => {
      expect(() => parseAnalysisResponse('', reason)).toThrow(/safety filters/i);
    });

    it(`explains a ${reason} stop part-way through`, () => {
      expect(() => parseAnalysisResponse(TRUNCATED, reason)).toThrow(/part-way|safety filters/i);
    });
  }
});

describe('parseAnalysisResponse — empty and schema-valid-but-useless', () => {
  it('rejects an empty body', () => {
    expect(() => parseAnalysisResponse('', undefined)).toThrow(/empty response/i);
    expect(() => parseAnalysisResponse('   ', undefined)).toThrow(/empty response/i);
  });

  it('rejects JSON that parses but has no layout', () => {
    // This used to pass and surface much later as a render crash on a missing
    // layout.sections, a long way from the cause.
    expect(() => parseAnalysisResponse('{}', undefined)).toThrow(/malformed/i);
    expect(() => parseAnalysisResponse('{"markdown":"hi"}', undefined)).toThrow(/malformed/i);
    expect(() => parseAnalysisResponse('{"layout":{}}', undefined)).toThrow(/malformed/i);
  });

  it('rejects a layout whose sections are missing', () => {
    expect(() => parseAnalysisResponse('{"layout":{"pageWidth":850}}', undefined)).toThrow(/malformed/i);
  });

  it('never throws an error with an empty message', () => {
    for (const [text, reason] of [['', undefined], ['{{{', undefined], ['', 'MAX_TOKENS'], [TRUNCATED, 'SAFETY']] as const) {
      let message = 'NOT THROWN';
      try { parseAnalysisResponse(text as string, reason as string | undefined); } catch (e: any) { message = e.message; }
      expect(message.trim().length).toBeGreaterThan(0);
      expect(message).not.toBe('NOT THROWN');
    }
  });
});
