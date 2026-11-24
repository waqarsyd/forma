/**
 * The one key scrubber (2026-11-24, the MCP work's wave 8; finding SEC-7 of
 * the 2026-11-23 design audit). The web app's error reports
 * (errorReport.ts), its "Report this problem" issue (problemReport.ts) and
 * Forma's MCP server (src/mcp: every result, every error and every line on
 * its stderr) all take keys out through this file, so a key format learned
 * once is taken out everywhere. Until then errorReport.ts and problemReport.ts
 * each kept a pattern of their own, and the two had drifted: only the first
 * knew the generic `sk-`, `pk-` and `rk-` keys.
 *
 * What `KEYS` takes out, each said as "(a key)":
 *
 * - a Gemini key in either of AI Studio's formats, the classic `AIza...`
 *   and the newer `AQ.` one (about 53 characters, 2026-11-12);
 * - an OpenRouter key, `sk-or-v1-` and its hex;
 * - another provider's `sk-`, `pk-` or `rk-` key of 16 characters or more;
 * - a bearer token as an Authorization header carries it (`Bearer ...`),
 *   whatever its format: a Local AI server such as LM Studio can be set to
 *   ask for one, and a token of its own has no shape to match.
 *
 * A token with no shape is caught only by its value, which is why
 * `redactorFor` also takes the literal secrets a process was given (the MCP
 * server's keys from its own environment), each taken out wherever it
 * appears, the longest first, before the patterns run. A value shorter than
 * `MIN_SECRET` characters is not taken out by value: it could not be a key,
 * and taking it out would cut words apart.
 *
 * The MCP server takes out `FORMA_KEYS`, the formats of the keys Forma itself
 * is given (Gemini's two and OpenRouter's), and its own keys by value, but
 * not the generic forms (the review of the MCP work's wave 8, W8C-2): its
 * results and its log name files and carry a report's text, where `sk-`,
 * `pk-` and `rk-` begin ordinary names and "bearer" is an ordinary word, and
 * with the generic forms a file named sk-customer-invoices-2026.repx came
 * back as "(a key).repx", a file that does not exist. It holds no other key:
 * it reads no Local AI token, and a key of another provider inside a file it
 * reads is in the user's own file, which the host can read anyway. The web
 * app's error reports and problem report keep every form.
 *
 * It imports nothing, so the MCP server's stdout guard can load it before
 * anything else (src/mcp/stdoutGuard.ts, held by src/mcp/boundaries.test.ts).
 *
 * Pure ASCII.
 */

/** The formats of the keys Forma itself is given, Gemini's two and OpenRouter's: what the MCP server takes out by shape (the header). */
export const FORMA_KEYS = /AIza[0-9A-Za-z_-]{35}|\bAQ\.[A-Za-z0-9._-]{20,}|sk-or-v1-[0-9a-f]+/g;

/** Every key format Forma takes out of a text, `FORMA_KEYS` and the generic forms: see the header. */
export const KEYS = new RegExp(`${FORMA_KEYS.source}|\\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\\b[Bb]earer\\s+[A-Za-z0-9._~+/=-]{8,}`, 'g');

/** What a key is said as. */
export const REDACTED = '(a key)';

/** The shortest value taken out by value alone. */
export const MIN_SECRET = 8;

/** Text with every key `KEYS` knows said as "(a key)". */
export function withoutKeys(text: string): string {
  return text.replace(KEYS, () => REDACTED);
}

/**
 * A scrubber that takes out each of `secrets` by its value (blank and short
 * ones aside), then every key `pattern` knows: `KEYS` unless another is
 * given, and the MCP server gives `FORMA_KEYS`. The values are copied, never
 * kept in a pattern, so a secret holding a pattern's own characters is still
 * matched exactly.
 */
export function redactorFor(secrets: readonly (string | null | undefined)[], pattern: RegExp = KEYS): (text: string) => string {
  const values = [...new Set(secrets.map((s) => (s ?? '').trim()).filter((s) => s.length >= MIN_SECRET))].sort((a, b) => b.length - a.length);
  return (text: string) => {
    let out = text;
    for (const value of values) if (out.includes(value)) out = out.split(value).join(REDACTED);
    return out.replace(pattern, () => REDACTED);
  };
}
