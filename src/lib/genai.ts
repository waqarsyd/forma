/**
 * The Gemini SDK, loaded when a request is about to be made.
 *
 * `geminiService.ts` opened with `import { GoogleGenAI, Type } from
 * "@google/genai"`, so the SDK was in the eager bundle — in front of every
 * visitor to the landing page, the features page and the privacy policy, none
 * of which can generate anything (audit PERF-001).
 *
 * It is only reachable from two functions, `chatReply` and
 * `analyzeReportDesign`, and both already refuse before they get here if there
 * is no API key. So the SDK now arrives at the same moment the user's first
 * request does, which is a wait they are already having.
 *
 * Note this is *not* the whole Gemini path. Model discovery and probing
 * (`discoverModels`, `probeModel`) use plain `fetch` against the REST endpoint
 * and stay eager — they are small, and `validateApiKey` calls them from the
 * settings dialog before any SDK work happens.
 */
type GenAI = typeof import('@google/genai');

let pending: Promise<GenAI> | null = null;

/**
 * Load the SDK.
 *
 * Memoised on the promise rather than the module: `analyzeReportDesign` and
 * `chatReply` can both be in flight, and the first generation of a session may
 * race a chat message.
 */
export function loadGenAI(): Promise<GenAI> {
  if (!pending) pending = import('@google/genai');
  return pending;
}

/** Test seam. Not for application use — the memo is deliberate at runtime. */
export function resetGenAIForTests(): void {
  pending = null;
}
