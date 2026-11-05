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
 * the model wrote most of the report and was cut off mid-tag, and the XML is
 * unfinished exactly as it would be for nonsense. Only `finishReason` separates
 * ran-out-of-room from garbage, and getting it wrong is wrong twice over — it
 * blames the model for output that was fine as far as it got, and it tells the
 * user to try again, which for the same input fails the same way every time.
 *
 * Since 2026-11-05 the answer is the REPX as raw XML, not a JSON object
 * holding it beside a layout and a spec; these are the same cases over that.
 *
 * Fixtures, no network, no key, no mocking.
 */
import { describe, it, expect } from 'vitest';
import { parseRepxAnswer, repxOfAnswer } from './analysisResponse';

const DOCUMENT =
  '<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v23.2" DisplayName="Quarterly Invoice" ReportUnit="HundredthsOfAnInch" PageWidth="850"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="20" /></Bands></XtraReportsLayoutSerializer>';

/** The same answer cut off mid-tag, as a MAX_TOKENS stop produces. */
const TRUNCATED = DOCUMENT.slice(0, Math.floor(DOCUMENT.length * 0.62));

describe('parseRepxAnswer — success', () => {
  it('returns the document', () => {
    expect(parseRepxAnswer(DOCUMENT, undefined).repxContent).toBe(DOCUMENT);
  });

  it('tolerates surrounding whitespace, a fence and a sentence of preamble', () => {
    expect(parseRepxAnswer(`\n\n  ${DOCUMENT}\n `, undefined).repxContent).toBe(DOCUMENT);
    expect(parseRepxAnswer(`Here is the report:\n\`\`\`xml\n${DOCUMENT}\n\`\`\``, 'STOP').repxContent).toBe(DOCUMENT);
  });

  it('takes the REPX out of an answer in the old JSON shape, as a local model may still write', () => {
    const old = JSON.stringify({ markdown: '# Quarterly Invoice', layout: { sections: [] }, repxContent: DOCUMENT });
    expect(repxOfAnswer(old)).toBe(DOCUMENT);
    expect(parseRepxAnswer(old, 'STOP').repxContent).toBe(DOCUMENT);
  });
});

describe('parseRepxAnswer — truncation is not malformity', () => {
  it('says the report was cut off, not that the model returned nonsense', () => {
    // The regression this file exists for. Before 2026-08-26 this produced
    // "The AI returned a malformed report. Try generating again."
    expect(() => parseRepxAnswer(TRUNCATED, 'MAX_TOKENS')).toThrow(/cut off/i);
  });

  it('does not tell the user to simply try again, because that would fail identically', () => {
    let message = '';
    try { parseRepxAnswer(TRUNCATED, 'MAX_TOKENS'); } catch (e: any) { message = e.message; }
    expect(message).toMatch(/simpler|fewer|split/i);
    expect(message).toMatch(/same limit|same way/i);
  });

  it('reports an empty body with MAX_TOKENS as too large, not as empty', () => {
    expect(() => parseRepxAnswer('', 'MAX_TOKENS')).toThrow(/too large/i);
  });

  it('calls an answer with no report in it what it is', () => {
    expect(() => parseRepxAnswer('not a report at all {{{', undefined)).toThrow(/without a report/i);
    expect(() => parseRepxAnswer('{"markdown":"hi"}', 'STOP')).toThrow(/without a report/i);
  });

  it('returns an unfinished document with an ordinary finish, which the request loop has already retried', () => {
    // The audit then names it `truncated`; refusing it here would lose what
    // the model did write, with nothing better to offer.
    expect(parseRepxAnswer(TRUNCATED, 'STOP').repxContent).toBe(TRUNCATED);
  });
});

describe('parseRepxAnswer — blocked', () => {
  for (const reason of ['SAFETY', 'PROHIBITED_CONTENT']) {
    it(`explains a ${reason} stop on an empty body`, () => {
      expect(() => parseRepxAnswer('', reason)).toThrow(/safety filters/i);
    });

    it(`explains a ${reason} stop part-way through`, () => {
      expect(() => parseRepxAnswer(TRUNCATED, reason)).toThrow(/part-way|safety filters/i);
    });
  }
});

describe('parseRepxAnswer — empty', () => {
  it('rejects an empty body', () => {
    expect(() => parseRepxAnswer('', undefined)).toThrow(/empty response/i);
    expect(() => parseRepxAnswer('   ', undefined)).toThrow(/empty response/i);
  });

  it('never throws an error with an empty message', () => {
    for (const [text, reason] of [['', undefined], ['{{{', undefined], ['', 'MAX_TOKENS'], [TRUNCATED, 'SAFETY']] as const) {
      let message = 'NOT THROWN';
      try { parseRepxAnswer(text as string, reason as string | undefined); } catch (e: any) { message = e.message; }
      expect(message.trim().length).toBeGreaterThan(0);
      expect(message).not.toBe('NOT THROWN');
    }
  });
});
