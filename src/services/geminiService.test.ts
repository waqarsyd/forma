import { describe, it, expect } from 'vitest';
import { extractPartialReply, asReadableError } from './geminiService';

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
