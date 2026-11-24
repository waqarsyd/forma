/**
 * The one key scrubber (2026-11-24, the MCP work's wave 8, SEC-7): every key
 * format the web app's error reports, its problem report and the MCP server
 * take out, and the literal values a process was given. Every key here is
 * built at run time from parts, so no key-shaped literal sits in the file
 * (the pre-commit hook would refuse one, TST-10).
 */
import { describe, expect, it } from 'vitest';
import { FORMA_KEYS, KEYS, REDACTED, MIN_SECRET, redactorFor, withoutKeys } from './keyRedact';

const gemini = ['AI', 'za', 'Sy'].join('') + 'B'.repeat(33);
const newer = ['A', 'Q.'].join('') + 'Ab8RN6x-'.repeat(6);
const openRouter = ['sk', 'or', 'v1'].join('-') + '-' + 'ab12'.repeat(16);
const other = ['sk', 'proj'].join('-') + '_' + 'Z9'.repeat(12);
const token = 'lmstudio-' + 'tok9'.repeat(5);

describe('withoutKeys', () => {
  it.each([
    ['a Gemini key in the classic form', gemini],
    ['a Gemini key in the newer AQ. form', newer],
    ['an OpenRouter key', openRouter],
    ["another provider's sk- key", other],
    ['a bearer token as an Authorization header carries it', `Bearer ${token}`],
  ])('takes out %s', (_what, key) => {
    const said = withoutKeys(`failed with ${key} at the server`);
    expect(said).not.toContain(key);
    expect(said).toBe(`failed with ${REDACTED} at the server`);
  });

  it('leaves ordinary words alone, a replacement pattern included', () => {
    for (const plain of ['See FAQ.html', 'a $& b', 'Bearer of bad news', 'sk-short', 'Request failed: 429 Too Many Requests']) expect(withoutKeys(plain)).toBe(plain);
  });

  it('is one pattern, global, so every key in a text is taken out', () => {
    expect(KEYS.flags).toContain('g');
    expect(withoutKeys(`${gemini} and ${openRouter}`)).toBe(`${REDACTED} and ${REDACTED}`);
  });
});

describe('redactorFor', () => {
  it("takes out a token with no shape of its own by its value, wherever it appears, as well as every key's shape", () => {
    const redact = redactorFor([token, undefined, null, '', gemini]);
    const said = redact(`token=${token}; again ${token}; key ${gemini}; ${openRouter}`);
    for (const secret of [token, gemini, openRouter]) expect(said).not.toContain(secret);
    expect(said).toBe(`token=${REDACTED}; again ${REDACTED}; key ${REDACTED}; ${REDACTED}`);
  });

  it('takes the longest value out first, so a value inside another leaves no part of the longer one', () => {
    const long = `${token}-extended`;
    expect(redactorFor([token, long])(`x ${long} y`)).toBe(`x ${REDACTED} y`);
  });

  it(`does not take out a value shorter than ${MIN_SECRET} characters, which could not be a key and would cut words apart`, () => {
    expect(redactorFor(['abc', '1234567'])('abc 1234567 abcdef')).toBe('abc 1234567 abcdef');
  });

  it('matches a value holding a pattern\'s own characters exactly, never as a pattern', () => {
    const odd = 'a.b*c+d?(e)[f]';
    expect(redactorFor([odd])(`x ${odd} aXbbbcd`)).toBe(`x ${REDACTED} aXbbbcd`);
  });

  it("with FORMA_KEYS, as the MCP server builds it, takes out Forma's own key forms and its keys by value, and leaves a file named sk-... and the word bearer alone (W8C-2)", () => {
    const redact = redactorFor([token], FORMA_KEYS);
    const said = redact(`${gemini} ${newer} ${openRouter} ${token}`);
    expect(said).toBe([REDACTED, REDACTED, REDACTED, REDACTED].join(' '));
    for (const plain of ['G:\\Reports\\sk-customer-invoices-2026.generated.repx', '/home/me/rk-regional-summary-q4.repx', 'Pay the bearer instrument on demand']) expect(redact(plain)).toBe(plain);
    // The web app's reports keep every form.
    expect(withoutKeys('G:\\Reports\\sk-customer-invoices-2026.repx')).toBe(`G:\\Reports\\${REDACTED}.repx`);
    expect(KEYS.source.startsWith(FORMA_KEYS.source)).toBe(true);
  });
});
