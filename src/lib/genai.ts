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

/** Google's Gemini API, the one address a Gemini request may go to. */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/';

/**
 * What every Gemini client is built with (2026-11-23, the MCP design audit's
 * SEC-1). The SDK's Node build reads GOOGLE_GEMINI_BASE_URL,
 * GOOGLE_VERTEX_BASE_URL, GOOGLE_GENAI_USE_VERTEXAI,
 * GOOGLE_GENAI_USE_ENTERPRISE and GOOGLE_GENAI_API_VERSION from the
 * environment even when a key is passed, so a variable set wherever Forma runs
 * in Node (the MCP server, a script) would send the key and the whole report
 * to another address or to Vertex AI. In the browser the CSP's connect-src
 * stops that; in Node nothing does. Explicit options win over every one of
 * those variables. They are the SDK's own defaults for the Gemini API (3.6.1:
 * the v1 API, not v1beta, which only the plain-fetch model probes use), so
 * they change nothing in the browser; a review of the first draft caught a
 * pinned v1beta that would have moved every browser request.
 */
export function geminiClientOptions(apiKey: string) {
  return { apiKey, vertexai: false, apiVersion: 'v1', httpOptions: { baseUrl: GEMINI_BASE_URL } };
}

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
