import { describe, it, expect } from 'vitest';
import { extractPartialReply, asReadableError, isOverloaded, isTruncatedStream } from './geminiService';

/**
 * `extractPartialReply` types the assistant's answer into the bubble as the
 * schema-constrained JSON streams in. Its contract is a property, not a case:
 * *every* possible chunk boundary must yield a clean prefix of the final reply
 * — never JSON punctuation, never a dangling backslash. A violation shows up as
 * stray characters flickering in the UI rather than as an error, which is
 * exactly the kind of thing that survives manual testing.
 */
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