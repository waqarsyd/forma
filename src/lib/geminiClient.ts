/**
 * The generation service, loaded when the user first asks for something — not
 * when the page loads.
 *
 * ## What was eager, and why it should not have been
 *
 * `App.tsx` imported `analyzeReportDesign`, `chatReply` and friends directly, so
 * `services/geminiService.ts` sat in the entry chunk. That file is mostly one
 * enormous template literal: measured in the built bundle on 2026-09-04, the
 * mega-prompt alone is **19,615 B of the 648,550 B eager chunk — 3.0%** — and
 * every visitor to the landing page, the features page and the privacy policy
 * downloaded all of it. None of those pages can generate anything. The workspace
 * itself cannot either until a key is configured.
 *
 * This is the same move `lib/firebaseClient.ts` made for the SDK on 2026-09-01,
 * and `lib/pdf.ts` and `lib/genai.ts` before it. The precedent matters for the
 * expectation it sets: deferring Firebase took 502,540 B off the entry chunk and
 * **added 148,489 B to the total**, because the same modules spread across more
 * chunks tree-shake and dedupe less well than they did in one. Code-splitting is
 * a trade, not a free win. It is the right trade when most of the payload is
 * never requested, which is the case here.
 *
 * ## Two things deliberately stayed eager
 *
 * - **`lib/modelCache.ts`.** `App.tsx` clears the cached model from a
 *   synchronous `useEffect` when the key changes. Behind this import that would
 *   become a promise, and the clear would land a tick after the change that
 *   caused it. See that file.
 * - **The types.** `App.tsx` still writes `import type { ReportLayout, … } from
 *   './services/geminiService'`. A type-only import is erased entirely, so it
 *   costs nothing at runtime — and moving the type declarations somewhere else
 *   to "be safe" would be churn with no measurable effect. If you convert that
 *   line to a value import by accident, the whole service comes back and the
 *   entry chunk's budget in `scripts/check-bundle-size.mjs` is what will tell
 *   you.
 */
type GeminiService = typeof import('../services/geminiService');

let pending: Promise<GeminiService> | null = null;

/**
 * Load the generation service.
 *
 * Memoised on the promise rather than the module, like `loadGenAI` and
 * `loadFirebase`: a chat turn and a generation can both be the first caller, and
 * `handleSend` routinely does one straight after the other.
 */
export function loadGemini(): Promise<GeminiService> {
  if (!pending) pending = import('../services/geminiService');
  return pending;
}

/**
 * Is this the "no key configured" error?
 *
 * A predicate rather than an `instanceof`, and the reason is the chunk boundary
 * this file creates. The three call sites are all `catch` blocks, and reaching
 * the class to compare against would mean holding the loaded module in a
 * variable declared outside the `try` purely so the `catch` can see it — in two
 * separate handlers, one of which uses it twice.
 *
 * `MissingApiKeyError`'s constructor sets `this.name`, and it does so precisely
 * so the error stays identifiable. `geminiClient.test.ts` constructs a real one
 * and asserts this predicate matches it, so the two cannot drift apart: rename
 * the class without its `name`, and that test fails.
 *
 * The cost of the weaker check is that a different error happening to carry the
 * same `name` would be misread as a missing key. Nothing constructs one, and the
 * consequence would be opening the settings dialog.
 */
export function isMissingApiKey(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'MissingApiKeyError';
}
