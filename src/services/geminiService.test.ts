import { describe, it, expect, vi } from 'vitest';
import {
  extractPartialReply,
  asReadableError,
  isOverloaded,
  isTruncatedStream,
  isMockMode,
  misorderMockHeaders,
  MOCK_MISORDERED,
  MOCK_INVOICE_RESPONSE,
  CHAT_INSTRUCTIONS,
  generateSmall,
  SMALL_CALL_THINKING_ROOM,
  REPORT_CHAT_INSTRUCTIONS,
  nextFallbackModel,
  parseJsonAnswer,
} from './geminiService';
import { noteModelOverloaded } from '../lib/modelCache';
import { auditRepx } from '../lib/repxAudit';
import { SUPPORTED_PAGE_SIZES } from '../lib/reportGeometry';
import { liftReportMargins } from '../lib/repxMargins';
import { ensureUniqueRefs } from '../lib/repxRefs';
import { normalizeItemNames } from '../lib/repxItems';

/**
 * `extractPartialReply` types the assistant's answer into the bubble as the
 * schema-constrained JSON streams in. Its contract is a property, not a case:
 * *every* possible chunk boundary must yield a clean prefix of the final reply
 * — never JSON punctuation, never a dangling backslash. A violation shows up as
 * stray characters flickering in the UI rather than as an error, which is
 * exactly the kind of thing that survives manual testing.
 */
/* The agent audit's batch E (2026-11-07): the fallback's choice and a tolerant reading. */
describe('nextFallbackModel and parseJsonAnswer', () => {
  it('skips models tried or parked, and on a chat turn tries the lighter models before the one reports use', () => {
    const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
    expect(nextFallbackModel(models, ['gemini-2.5-flash'])).toBe('gemini-2.5-pro');
    expect(nextFallbackModel(models, ['gemini-2.5-flash-lite'], { light: true, mainModel: 'gemini-2.5-flash' })).toBe('gemini-2.5-pro');
    expect(nextFallbackModel(models, [], { light: true, mainModel: 'gemini-2.5-flash' })).toBe('gemini-2.5-flash-lite');
    expect(nextFallbackModel(['gemini-2.5-flash'], [], { light: true, mainModel: 'gemini-2.5-flash' })).toBe('gemini-2.5-flash');
    noteModelOverloaded('gemini-2.5-pro', 1_000);
    expect(nextFallbackModel(models, ['gemini-2.5-flash'], { now: 2_000 })).toBe('gemini-2.5-flash-lite');
    expect(nextFallbackModel(models, models)).toBeUndefined();
  });

  it('reads a JSON answer fenced, after a sentence, or plain, and nothing from no object', () => {
    expect(parseJsonAnswer('```json\n{"reply":"hi","wantsReport":true}\n```')).toEqual({ reply: 'hi', wantsReport: true });
    expect(parseJsonAnswer('Sure! Here is the answer: {"reply":"ok"} Hope that helps.')).toEqual({ reply: 'ok' });
    expect(parseJsonAnswer('{"reply":"plain"}')).toEqual({ reply: 'plain' });
    expect(parseJsonAnswer('no object here')).toBeNull();
    expect(parseJsonAnswer('[1,2]')).toBeNull();
  });
});

/* The report turn's instructions (2026-11-05, lib/agentEdit.ts). */
describe('REPORT_CHAT_INSTRUCTIONS', () => {
  it('tells the model the outline is the report, and to name controls as it does', () => {
    expect(REPORT_CHAT_INSTRUCTIONS).toContain('It IS the report the user is looking at.');
    expect(REPORT_CHAT_INSTRUCTIONS).toContain('Name controls exactly as the outline does.');
  });

  // The agent audit's batch B (2026-11-07): a new report, the whole request, and the memory obeyed.
  it('offers a new report, asks for the whole request with a design, and makes the memory standing instructions', () => {
    expect(REPORT_CHAT_INSTRUCTIONS).toMatch(/- "new": the user asks for a different report/);
    expect(REPORT_CHAT_INSTRUCTIONS).toContain('"brief": with "rebuild" or "new", the whole request');
    expect(REPORT_CHAT_INSTRUCTIONS).toContain("THE USER'S REMEMBERED PREFERENCES are given, they are standing instructions");
    expect(CHAT_INSTRUCTIONS).toContain('When "wantsReport" is true, also write "brief"');
  });

  // The agent audit's batch C (2026-11-07): items 10 and 11.
  it('offers only the papers the edit makes, and lets the model say what the outline does not show', () => {
    expect(REPORT_CHAT_INSTRUCTIONS).toContain(`paper (${SUPPORTED_PAGE_SIZES.join(', ')})`);
    expect(REPORT_CHAT_INSTRUCTIONS).not.toMatch(/\bA3\b|\bA5\b/);
    expect(REPORT_CHAT_INSTRUCTIONS).not.toContain('never say you cannot see the report');
    expect(REPORT_CHAT_INSTRUCTIONS).toContain('say it does not show rather than guessing');
  });

  // The agent audit's batch D (2026-11-07): items 22 and 85.
  it('describes every new edit, the table row and column rule, and the undo tool', () => {
    for (const op of ['duplicate:', 'border:', 'line:', 'format:', 'bind:', 'pageNumber:']) expect(REPORT_CHAT_INSTRUCTIONS).toContain(`- ${op}`);
    expect(REPORT_CHAT_INSTRUCTIONS).toContain('bandHeight: band, height');
    expect(REPORT_CHAT_INSTRUCTIONS).toContain('a whole row by row alone (a header row), a column by cell alone');
    expect(REPORT_CHAT_INSTRUCTIONS).toContain('undo (takes back the last change');
  });
});

describe('extractPartialReply', () => {
  const cases: Array<{ name: string; reply: string }> = [
    { name: 'plain text', reply: 'Hello there, this is a reply.' },
    { name: 'embedded quotes', reply: 'She said "use a table" and left.' },
    { name: 'newlines', reply: 'Line one\nLine two\nLine three' },
    { name: 'backslashes', reply: 'Path C:\\reports\\invoice.repx' },
    { name: 'unicode escapes', reply: 'Em dash — and an ellipsis …' },
    { name: 'tabs and returns', reply: 'a\tb\r\nc' },
    { name: 'empty', reply: '' },
  ];

  for (const { name, reply } of cases) {
    it(`yields a clean prefix at every split point — ${name}`, () => {
      const full = JSON.stringify({ reply, wantsReport: false });

      for (let cut = 0; cut <= full.length; cut++) {
        const partial = extractPartialReply(full.slice(0, cut));

        // The load-bearing assertion. A half-decoded escape cannot satisfy this:
        // emitting a raw "\" from an incomplete \n would not be a prefix of a
        // reply whose next character is an actual newline.
        expect(reply.startsWith(partial)).toBe(true);
        // The next key must never leak into the bubble.
        expect(partial).not.toContain('wantsReport');
        // Only meaningful where the reply has no backslash of its own — a reply
        // containing "C:\reports" has legitimate prefixes ending in one.
        if (!reply.includes('\\')) expect(partial.endsWith('\\')).toBe(false);
      }
    });
  }

  it('never emits a raw backslash when an escape is split across chunks', () => {
    // The reply's own characters include no backslash, so any "\" that appears
    // in the output could only have come from a half-received \n escape.
    const reply = 'first\nsecond\nthird';
    const full = JSON.stringify({ reply, wantsReport: false });
    expect(full).toContain('\\n'); // the escape really is in the wire format

    for (let cut = 0; cut <= full.length; cut++) {
      expect(extractPartialReply(full.slice(0, cut))).not.toContain('\\');
    }
  });

  it('recovers the whole reply once the object is complete', () => {
    for (const { reply } of cases) {
      const full = JSON.stringify({ reply, wantsReport: true });
      expect(extractPartialReply(full)).toBe(reply);
    }
  });

  it('grows monotonically as chunks arrive', () => {
    const reply = 'Progressive display should only ever add characters.';
    const full = JSON.stringify({ reply, wantsReport: false });

    let previous = '';
    for (let cut = 0; cut <= full.length; cut++) {
      const partial = extractPartialReply(full.slice(0, cut));
      expect(partial.startsWith(previous)).toBe(true);
      previous = partial;
    }
    expect(previous).toBe(reply);
  });

  it('returns empty when the reply key has not arrived yet', () => {
    expect(extractPartialReply('')).toBe('');
    expect(extractPartialReply('{')).toBe('');
    expect(extractPartialReply('{"rep')).toBe('');
    expect(extractPartialReply('{"reply"')).toBe('');
    expect(extractPartialReply('{"reply":')).toBe('');
  });
});

/**
 * Provider errors arrive with the upstream JSON envelope stuffed into
 * `.message`, sometimes nested twice. Rendering that verbatim showed the user a
 * wall of braces.
 */
describe('asReadableError', () => {
  it('unwraps a single JSON envelope', () => {
    const raw = new Error('{"error":{"code":503,"message":"The model is overloaded."}}');
    expect(asReadableError(raw).message).toBe('The model is overloaded.');
  });

  it('unwraps a doubly-nested envelope', () => {
    const inner = JSON.stringify({ error: { code: 429, message: 'Quota exceeded.' } });
    const raw = new Error(JSON.stringify({ error: { message: inner } }));
    expect(asReadableError(raw).message).toBe('Quota exceeded.');
  });

  it('passes AbortError through untouched so cancellation stays distinguishable', () => {
    const abort = new DOMException('The user aborted a request.', 'AbortError');
    expect(asReadableError(abort)).toBe(abort);
  });

  it('falls back to the original text when nothing parses', () => {
    expect(asReadableError(new Error('Network unreachable')).message).toBe('Network unreachable');
  });

  it('never produces an empty message', () => {
    expect(asReadableError(new Error('')).message.length).toBeGreaterThan(0);
    expect(asReadableError({}).message.length).toBeGreaterThan(0);
    expect(asReadableError(undefined).message.length).toBeGreaterThan(0);
  });
});

/**
 * These two decide whether a chat turn is retried or lost. Both were reported
 * from a real session on 2026-09-05: a 503 arrived as "This model is currently
 * experiencing high demand" and the SDK's SSE reader raised "Incomplete JSON
 * segment at the end" twice in a row, and neither was retried, while a
 * generation hitting the same outage retried twice and changed model.
 */
describe('isOverloaded', () => {
  it('recognises the message the user actually saw', () => {
    expect(isOverloaded(new Error('This model is currently experiencing high demand.'))).toBe(true);
  });

  it('recognises a 503 however the SDK reports it', () => {
    expect(isOverloaded({ status: 503 })).toBe(true);
    expect(isOverloaded({ status: 'UNAVAILABLE' })).toBe(true);
    expect(isOverloaded(new Error('got 503 from upstream'))).toBe(true);
    expect(isOverloaded(new Error('The model is overloaded. Please try again.'))).toBe(true);
  });

  it('does not retry failures that would fail again', () => {
    for (const err of [
      new Error('API key not valid'),
      { status: 400, message: 'INVALID_ARGUMENT' },
      { status: 404, message: 'model not found' },
      new Error('quota exceeded'),
      null,
      undefined,
    ]) {
      expect(isOverloaded(err), `wrongly retried: ${JSON.stringify(err)}`).toBe(false);
    }
  });
});

describe('isTruncatedStream', () => {
  it('recognises the SDK error that broke two chat turns in a row', () => {
    expect(isTruncatedStream(new Error('Incomplete JSON segment at the end'))).toBe(true);
  });

  it('recognises the other ways a stream ends early', () => {
    for (const message of ['Unexpected end of JSON input', 'network error', 'Failed to fetch']) {
      expect(isTruncatedStream(new Error(message)), message).toBe(true);
    }
  });

  it('leaves a malformed-but-complete response alone', () => {
    // The parser already salvages those; retrying would cost a request and
    // return the same thing.
    expect(isTruncatedStream(new Error('Unexpected token < in JSON at position 0'))).toBe(false);
    expect(isTruncatedStream(new Error('API key not valid'))).toBe(false);
    expect(isTruncatedStream(null)).toBe(false);
  });
});

/*
 * Mock mode returns this fixture and returns early — before `normalizeItemNames`,
 * `ensureUniqueRefs`, `liftReportMargins` and `liftParameterTypes`, all of which
 * run on a real generation. So whatever the fixture says *is* what the workspace
 * shows offline, and if it differs from what the pipeline would produce, every
 * screenshot and every offline check quietly describes a report the app does not
 * actually make.
 *
 * It did differ, in exactly one way, and it took someone reading a real
 * DevExpress file to notice: the fixture declared `Margins="0, 0, 0, 0"` with
 * both margin bands at zero, while the lift would have turned it into
 * `20, 20, 20, 20` — the same values DevExpress's own empty report carries.
 *
 * These assert the fixture is a fixed point of the repairs: run them over it and
 * nothing changes. A future edit that reintroduces the divergence fails here
 * rather than in a screenshot nobody compares.
 */
describe('the mock fixture is what the repair pipeline would produce', () => {
  const xml = MOCK_INVOICE_RESPONSE.repxContent;

  it('declares the margins it draws', () => {
    expect(xml).toContain('Margins="20, 20, 20, 20"');
    expect(xml).toMatch(/ControlType="TopMarginBand"[^>]*HeightF="20"/);
    expect(xml).toMatch(/ControlType="BottomMarginBand"[^>]*HeightF="20"/);
  });

  it('has nothing left for the margin lift to do', () => {
    const r = liftReportMargins(xml);
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/already declares margins/i);
  });

  it('has unique Refs and correctly numbered Items already', () => {
    expect(ensureUniqueRefs(xml).applied).toBe(false);
    expect(normalizeItemNames(xml).applied).toBe(false);
  });
});

describe('the deliberately misordered mock fixture', () => {
  /*
   * VITE_FORMA_MOCK="misordered" swaps the two header bands so `repxAudit`'s
   * band-order warning can be seen firing in a running app. The rule had six
   * unit tests and no way to be demonstrated in the UI: the mock is correct by
   * design, and a real generation needs a key.
   *
   * These assert the RESULT rather than the regexes, because the transform is
   * written against one specific fixture. If that fixture changes shape these
   * fail here, instead of quietly returning an unswapped report and making the
   * whole flag look broken.
   */
  const mock = MOCK_INVOICE_RESPONSE.repxContent;
  const swapped = misorderMockHeaders(mock);

  const bandSequence = (xml: string) =>
    [...xml.matchAll(/ControlType="(\w*Band)"/g)].map((m) => m[1]);

  it('leaves the fixture itself in print order', () => {
    expect(bandSequence(mock)).toEqual([
      'TopMarginBand', 'ReportHeaderBand', 'PageHeaderBand', 'DetailBand', 'BottomMarginBand',
    ]);
    expect(auditRepx(mock, null).findings.map((f) => f.code)).not.toContain('band-order');
  });

  it('puts the PageHeader before the ReportHeader', () => {
    expect(bandSequence(swapped)).toEqual([
      'TopMarginBand', 'PageHeaderBand', 'ReportHeaderBand', 'DetailBand', 'BottomMarginBand',
    ]);
  });

  it('makes the audit report band-order, which is the entire point', () => {
    const finding = auditRepx(swapped, null).findings.find((f) => f.code === 'band-order');
    expect(finding?.severity).toBe('warning');
  });

  it('reports band-order and NOTHING else, so the demonstration is unambiguous', () => {
    /*
     * The trap this guards. `ItemN` is a position inside its own collection, so
     * moving the blocks without renumbering also trips `item-numbering` -- and a
     * fixture lighting two findings teaches the reader that the app is broken
     * rather than that one rule works.
     */
    const before = auditRepx(mock, null).findings.map((f) => f.code);
    const after = auditRepx(swapped, null).findings.map((f) => f.code);
    expect(after.filter((c) => !before.includes(c))).toEqual(['band-order']);
    expect(after).not.toContain('item-numbering');
  });

  it('renumbers the bands it moved, rather than only moving them', () => {
    expect(swapped).toContain('<Item2 Ref="4" ControlType="PageHeaderBand"');
    expect(swapped).toContain('<Item3 Ref="2" ControlType="ReportHeaderBand"');
  });

  it('changes nothing but the order of those two blocks', () => {
    // Same bytes, same controls -- only the arrangement differs. A transform
    // that also dropped a control would still satisfy every test above.
    const sortedChars = (s: string) => s.replace(/\s+/g, ' ').split('').sort().join('');
    expect(sortedChars(swapped)).toBe(sortedChars(mock));
  });

  it('returns the input unchanged when the bands it expects are absent', () => {
    const other = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';
    expect(misorderMockHeaders(other)).toBe(other);
  });

  it('treats only the documented values as mock mode', () => {
    expect(isMockMode('true')).toBe(true);
    expect(isMockMode(MOCK_MISORDERED)).toBe(true);
    expect(isMockMode(undefined)).toBe(false);
    expect(isMockMode('')).toBe(false);
    expect(isMockMode('false')).toBe(false);
    // Not a boolean-ish coercion: an unrecognised value leaves mock mode off,
    // so a typo calls Gemini rather than silently returning a fake report.
    expect(isMockMode('yes')).toBe(false);
  });
});

/**
 * The chat turn decides whether a typed message goes on to be designed. With
 * a real key it answered a described report with a request for an image until
 * 2026-11-02, because its instructions still said Forma only converts uploaded
 * designs; the mock says yes to any build request and hid it.
 */
describe('the chat turn instructions', () => {
  it('take a written description as enough, and leave the open questions to Prompt-to-Report', () => {
    expect(CHAT_INSTRUCTIONS).toMatch(/written description alone/);
    expect(CHAT_INSTRUCTIONS).toMatch(/do NOT ask for an image, a PDF or a layout first/);
    expect(CHAT_INSTRUCTIONS).toMatch(/asks its own follow-up questions/);
    expect(CHAT_INSTRUCTIONS).not.toMatch(/turns an uploaded design/);
  });

  it('still keep small talk and a request with no content out of generation', () => {
    expect(CHAT_INSTRUCTIONS).toMatch(/"wantsReport" to false for greetings/);
    expect(CHAT_INSTRUCTIONS).toMatch(/say nothing about what the report should contain/);
  });
});

/**
 * Gemini 2.5 counts its thinking against maxOutputTokens, and the small calls
 * (clarification 512, expression 512, test data 4,096) never turned it off: a
 * clarification came back cut off 40 characters in with a real key on
 * 2026-11-02, so no described report was ever asked its questions.
 */
describe('generateSmall', () => {
  const request = (model: string) => ({ model, contents: [{ parts: [{ text: 'q' }] }], config: { temperature: 0, maxOutputTokens: 512 } });

  it('turns thinking off and keeps the limit', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{}' });
    await generateSmall({ models: { generateContent } } as never, request('small-a'));
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0].config).toMatchObject({ temperature: 0, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } });
  });

  it('asks a model that refuses a zero budget again with room to think, and remembers it', async () => {
    const generateContent = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('INVALID_ARGUMENT: thinking budget'), { status: 400 }))
      .mockResolvedValue({ text: '{}' });
    await generateSmall({ models: { generateContent } } as never, request('small-b'));
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0].config.thinkingConfig).toBeUndefined();
    expect(generateContent.mock.calls[1][0].config.maxOutputTokens).toBe(512 + SMALL_CALL_THINKING_ROOM);
    await generateSmall({ models: { generateContent } } as never, request('small-b'));
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(generateContent.mock.calls[2][0].config.thinkingConfig).toBeUndefined();
  });

  it('does not take a rejected key for a thinking refusal', async () => {
    const generateContent = vi.fn().mockRejectedValue(Object.assign(new Error('API key not valid. INVALID_ARGUMENT'), { status: 400 }));
    await expect(generateSmall({ models: { generateContent } } as never, request('small-c'))).rejects.toThrow(/API key/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});