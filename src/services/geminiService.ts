import { loadGenAI } from "../lib/genai";
import { usableFromCatalog, mergeCandidates } from "../lib/modelCatalog";
import { classifyGeminiError } from "../lib/geminiErrors";
import { parseAnalysisResponse } from "../lib/analysisResponse";
import { liftReportMargins } from "../lib/repxMargins";
import { ensureUniqueRefs } from "../lib/repxRefs";
import { bindDetailRow, bindFooterTotals, bindingEnabled } from "../lib/repxBindingPlan";
import { flatLayoutEnabled, rootStructurePrompt, tableRowsRule } from "../lib/reportBands";
import { checkRepxComplete, extractRepxDocument } from "../lib/repxTruncation";
import {
  pageSizeInUnits,
  unitsPerInch,
  unitsToPoints,
  pointsToUnits,
  resolveReportUnit,
  resolvePageSize,
} from "../lib/reportGeometry";


/**
 * The report shape moved to ../lib/reportTypes.ts on 2026-08-27 (audit
 * ARC-005): three modules in lib/ imported these upward, which were the only
 * edges in the graph pointing that way. Re-exported here because callers
 * reasonably think of them as part of this service's contract.
 */
export type {
  ReportCell,
  ReportRow,
  SourceRect,
  ReportElement,
  ReportSection,
  ReportLayout,
  AnalysisResponse,
  AttachmentPart,
} from "../lib/reportTypes";
import type { AnalysisResponse, ReportLayout, AttachmentPart } from "../lib/reportTypes";

export interface ReportConfig {
  version: string;
  unit: string;
  pageSize: string;
  header?: {
    showCompanyLogo?: boolean;
    title?: string;
  };
  footer?: {
    showPageNumbers?: boolean;
    customText?: string;
  };
  rtl?: boolean;
  spName?: string;
  customApiKey?: string;
  dataSchema?: string;
  modelName?: string;
  /**
   * Cap on internal "thinking" tokens, which are generated before any visible
   * output and are timed and billed like output.
   *
   * Left undefined the model decides for itself, which is the default and the
   * behaviour Forma has always had. `0` disables thinking entirely; a positive
   * number caps it. Worth reaching for only after the token-usage log shows a
   * large `thinking` count — Forma's prompt already reasons explicitly in its
   * PHASE 1 spatial-mapping pass, so internal thinking is partly redundant
   * here, but cutting it is a quality trade and should be measured, not
   * assumed.
   */
  thinkingBudget?: number;
}

const MOCK_INVOICE_RESPONSE: AnalysisResponse = {
  markdown: `# Mock Invoice Report\n\nThis is a mock layout generated dynamically during fallback mode.\n\n## Elements\n- **Header**: Invoice Title, Logo, Status.\n- **Detail**: Items Table.\n- **Footer**: Thank you note.`,
  repxContent: `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="100, 100, 100, 100" PageWidth="850" PageHeight="1100" Version="23.2">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
    <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="100">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="label1" Text="MOCK INVOICE REPORT" LocationFloat="0,10" SizeF="400,30" Padding="2,2,0,0,100" />
      </Controls>
    </Item2>
    <Item3 Ref="4" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" />
  </Bands>
</XtraReportsLayoutSerializer>`,
  layout: {
    title: "Mock Invoice Report",
    pageWidth: 850,
    sections: [
      {
        id: "header",
        name: "Header",
        type: "header",
        height: 100,
        elements: [
          { id: "lbl-title", type: "label", content: "INVOICE - FORMA MOCK ENGINE", x: 20, y: 20, width: 500, height: 40, fontSize: 16 }
        ]
      },
      {
        id: "detail",
        name: "Detail Band",
        type: "detail",
        height: 150,
        elements: [
          { id: "lbl-detail", type: "label", content: "Item Description: Mock Layout Development Service", x: 20, y: 20, width: 400, height: 25, fontSize: 10 },
          { id: "lbl-amount", type: "label", content: "Total: $1,250.00", x: 600, y: 20, width: 200, height: 25, fontSize: 12, textAlign: "right" }
        ]
      }
    ]
  }
};

/**
 * Forma is bring-your-own-key: the only source of an API key is the one the user
 * typed into the config modal, which arrives here as `config.customApiKey`.
 *
 * There is deliberately no environment fallback. An application-owned key read
 * from import.meta.env was previously inlined into the shipped bundle, and
 * Google's secret scanner revoked it (403 "reported as leaked"). The key now
 * goes from the user's browser straight to Google and never touches a build
 * artifact or a server. Do not reintroduce an env read on this path.
 */
// Must stay written as `import.meta.env` — Vite substitutes that exact
// expression at transform time. Writing `import.meta?.env` silently defeats the
// replacement, leaving an undefined value in the browser and a mock flag that
// never fires.
const viteEnv: Record<string, string | undefined> =
  (import.meta as any).env ?? {};

/** Thrown when no key is configured, so the UI can open the config modal instead of guessing. */
export class MissingApiKeyError extends Error {
  constructor() {
    super("Add your Gemini API key to generate a report.");
    this.name = "MissingApiKeyError";
  }
}

const abortError = () =>
  new DOMException("Report generation aborted by user.", "AbortError");

/** setTimeout that rejects with an AbortError instead of outliving a cancelled request. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Cheap liveness check for a user-supplied key, so the config modal can say
 * "valid" or "rejected" at paste time rather than failing on the first
 * generation. Lists models rather than generating, so it costs nothing.
 *
 * The key travels in the x-goog-api-key header, never the query string — a key
 * in a URL leaks into browser history, referrers and any intermediate log.
 */
export async function validateApiKey(
  apiKey: string
): Promise<{ valid: boolean; message: string; model?: string }> {
  const trimmed = apiKey?.trim();
  if (!trimmed) return { valid: false, message: "Enter a key first." };

  // A different key can have different model access, so never trust a choice
  // resolved for a previous one.
  clearCachedModel();

  try {
    // Validation and model detection are the same question — "can this key
    // actually generate something?" — so answer both with one pass. Checking
    // models.list instead would be misleading: it advertises models that the
    // generateContent endpoint then refuses with a 404.
    const model = await resolveModel(trimmed);
    return { valid: true, message: `Key is valid — using ${model}.`, model };
  } catch (err: any) {
    if (err?.message?.includes("Failed to fetch")) {
      return { valid: false, message: "Could not reach Google to check the key. Check your connection." };
    }
    return { valid: false, message: err?.message || "Could not validate this key." };
  }
}

/* ------------------------------------------------------------------ *
 * Model auto-detection
 *
 * Forma deliberately has no model picker. A hardcoded default rots: Google
 * retires models "for new users", so a fixed id keeps working for existing
 * projects while every freshly-created key gets a 404 on its first generate.
 * That is exactly what happened to the previous default, gemini-2.5-flash.
 *
 * Do NOT resolve this from models.list — that endpoint is not a reliable guide
 * to what a key can actually call. Measured on a live key: models.list happily
 * advertised gemini-2.5-flash with generateContent support, while the real call
 * returned 404 "no longer available to new users". Only an actual request tells
 * the truth, so resolution probes with a 1-token generation.
 * ------------------------------------------------------------------ */

/**
 * Tried in order, first success wins. `-latest` aliases lead because Google
 * repoints them as models are superseded, so they cannot go stale the way a
 * pinned id does. Flash tiers precede pro because the user pays for their own
 * usage — pro is a fallback, not a default.
 */
export const MODEL_PREFERENCE = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-2.0-flash",
  "gemini-pro-latest",
];

const MODEL_CACHE_KEY = "geminiModel:session";
/**
 * Every model the probe found this key *can* call, not just the winner. The
 * probes already ran and their results were being thrown away; keeping them is
 * what lets an overloaded generation fall back to a different model instead of
 * failing (see the 503 path in `analyzeReportDesign`).
 */
const MODEL_SET_CACHE_KEY = "geminiModels:session";
let resolvedModel: string | null = null;
let resolvedModelSet: string[] | null = null;

/** Exported so the debug console can report the detected model without re-probing. */
export function readCachedModel(): string | null {
  if (resolvedModel) return resolvedModel;
  try {
    return sessionStorage.getItem(MODEL_CACHE_KEY);
  } catch {
    return null; // Node, or storage disabled
  }
}

function cacheModel(model: string, usable?: string[]): void {
  resolvedModel = model;
  try {
    sessionStorage.setItem(MODEL_CACHE_KEY, model);
  } catch {
    /* in-memory copy still applies for this page */
  }
  if (usable) {
    resolvedModelSet = usable;
    try {
      sessionStorage.setItem(MODEL_SET_CACHE_KEY, JSON.stringify(usable));
    } catch {
      /* in-memory copy still applies for this page */
    }
  }
}

/**
 * Models this key can call, in preference order, or `null` if that has not been
 * established this session. Never probes: a caller that needs it to be
 * populated should have gone through `resolveModel` first.
 */
function readCachedModelSet(): string[] | null {
  if (resolvedModelSet) return resolvedModelSet;
  try {
    const raw = sessionStorage.getItem(MODEL_SET_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((m) => typeof m === "string") ? parsed : null;
  } catch {
    return null; // Node, storage disabled, or a corrupt entry
  }
}

/** Drop the cached choice — called when a model 404s mid-flight, or the key changes. */
export function clearCachedModel(): void {
  resolvedModel = null;
  resolvedModelSet = null;
  try {
    sessionStorage.removeItem(MODEL_CACHE_KEY);
    sessionStorage.removeItem(MODEL_SET_CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Ask Google what models exist. **Discovery only — never trusted as an answer.**
 *
 * `MODEL_PREFERENCE` is hand-written, and a hand-written list of model ids has a
 * shelf life: a key created in a year's time may have access to nothing on it.
 * Two entries are `-latest` aliases that Google repoints, which covers most of
 * that, but not a family shipped under a new name or a retired alias.
 *
 * This does not contradict the standing "never resolve models from
 * `models.list`" rule, and the distinction is worth stating plainly: that
 * endpoint is unreliable about what a key can **call** (it advertised
 * `gemini-2.5-flash` with `generateContent` while the real call 404'd) and
 * reliable about what **exists**. Everything it returns here is still confirmed
 * by a real 1-token probe before anything depends on it.
 *
 * Failure is not an error. No network, a blocked endpoint, an unexpected shape —
 * all resolve to an empty list and the curated preference order is used exactly
 * as it was before. Discovery can only ever add candidates.
 */
async function discoverModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      signal,
    });
    if (!res.ok) {
      console.debug(`Model catalogue unavailable (HTTP ${res.status}); using the curated list only.`);
      return [];
    }
    const body = await res.json();
    return usableFromCatalog(body?.models);
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    console.debug("Model catalogue could not be read; using the curated list only.", err);
    return [];
  }
}

/**
 * `network` is distinct from `unavailable` on purpose. Both mean "this model
 * did not answer", but they mean opposite things about *why*: `unavailable` is
 * Google declining, `network` is never having reached Google. They used to be
 * the same verdict, so an offline user was told "No Gemini model is available
 * to this API key. Create a new key in Google AI Studio and try again." — the
 * key was fine, and they could not have created a new one anyway.
 */
type Probe = "ok" | "unavailable" | "quota" | "keyError" | "network";

/**
 * A request that never reached the server, as opposed to one that was refused.
 *
 * `fetch` rejects with a TypeError for DNS failure, a dropped connection, a
 * blocked origin and an offline machine alike; an HTTP status, even a 500, means
 * the round trip happened.
 */
function isNetworkFailure(err: any): boolean {
  return (
    err instanceof TypeError ||
    /failed to fetch|network ?error|networkerror|fetch failed|enotfound|econnrefused/i.test(
      String(err?.message ?? "")
    )
  );
}

/**
 * How long one probe may take.
 *
 * Generous for a one-token request, and it exists because the probes run
 * concurrently behind `Promise.all`: without it, **one unresponsive endpoint
 * gates the entire generation**, and the user sees "starting" with no progress
 * and no explanation on an operation that already takes a minute (audit
 * REL-003). Too tight would be worse than absent — it would mark a slow but
 * working model unavailable — hence seconds rather than milliseconds.
 */
const PROBE_TIMEOUT_MS = 8000;

async function probeModel(model: string, apiKey: string, signal?: AbortSignal): Promise<Probe> {
  // Chained to the caller's signal so pressing Stop still cancels immediately;
  // whichever fires first wins.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        // One token is enough to learn whether the model will answer at all.
        body: JSON.stringify({
          contents: [{ parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: controller.signal,
      }
    );
    if (res.ok) return "ok";
    if (res.status === 404) return "unavailable";
    if (res.status === 429) return "quota";
    if (res.status === 403 || res.status === 400) return "keyError";
    return "unavailable";
  } catch (err: any) {
    // A user cancellation propagates; a probe that merely ran out of time does
    // not. Both surface as AbortError, so the caller's signal is what tells
    // them apart — otherwise a slow model would look like a user pressing Stop.
    if (err?.name === "AbortError") {
      if (signal?.aborted) throw err;
      return "unavailable";
    }
    return isNetworkFailure(err) ? "network" : "unavailable";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Pick a model this key can actually call. Cached per session, so the probing
 * cost is paid once rather than per generation.
 */
export async function resolveModel(apiKey: string, signal?: AbortSignal): Promise<string> {
  const cached = readCachedModel();
  if (cached) return cached;
  if (signal?.aborted) throw abortError();

  // Probe every candidate concurrently rather than one at a time. Sequential
  // probing charged a full round-trip per rejected model before the real
  // request could even start — a key without access to the first choice paid
  // that several times over, on the very first generation of every session.
  // The probes are one token each, so firing all of them costs nothing that
  // matters, and preference order is still honoured when reading the results.
  const started = Date.now();

  // Catalogue first, so a key that can reach nothing on the curated list still
  // has somewhere to go. It runs before the probes rather than beside them
  // because its results decide what to probe; it is one request and it can only
  // add candidates, never remove them.
  const discovered = await discoverModels(apiKey, signal);
  const candidates = mergeCandidates(MODEL_PREFERENCE, discovered);
  if (candidates.length > MODEL_PREFERENCE.length) {
    console.debug(
      `Catalogue added ${candidates.length - MODEL_PREFERENCE.length} model(s) the curated list does not know: ` +
      candidates.slice(MODEL_PREFERENCE.length).join(", ")
    );
  }

  const verdicts = await Promise.all(
    candidates.map((candidate) => probeModel(candidate, apiKey, signal))
  );
  console.debug(`Model probing finished in ${Date.now() - started}ms (${candidates.length} candidates).`);

  const usable = candidates.filter((_, i) => verdicts[i] === "ok");
  const winner = usable[0];
  if (winner) {
    console.log(
      `Auto-selected Gemini model: ${winner}` +
      (usable.length > 1 ? ` (${usable.length - 1} more available as fallbacks: ${usable.slice(1).join(", ")})` : "")
    );
    cacheModel(winner, usable);
    return winner;
  }

  // Nothing answered. Before blaming the key or the quota, rule out never
  // having reached Google at all: if *every* probe failed to connect, the
  // machine is offline or the endpoint is blocked, and no message about keys or
  // billing is true or actionable. Only "every" counts — a mix means some
  // requests did arrive, and what they came back with is the better clue.
  if (verdicts.length > 0 && verdicts.every((v) => v === "network")) {
    throw new Error(
      "Could not reach Google to check any model. Check your internet connection and try again — " +
      "your API key has not been tested."
    );
  }

  // A key-level rejection repeats for every candidate, so it is the real cause
  // and takes priority over the quota message below.
  if (verdicts.includes("keyError")) {
    throw new Error(
      "Your Gemini API key was rejected. Check that it is correct and that the Generative Language API is enabled for its project."
    );
  }

  const sawQuota = verdicts.includes("quota");

  if (sawQuota) {
    throw new Error(
      "Every model available to this key is over quota right now. Check your plan and billing in Google AI Studio, or try again later."
    );
  }
  throw new Error(
    "No Gemini model is available to this API key. Create a new key in Google AI Studio and try again."
  );
}

/** Live progress while the model writes its answer. See `onProgress` below. */
export interface StreamProgress {
  /** Characters of JSON received so far. */
  chars: number;
  /**
   * Best-effort 0-95. The total length is unknowable in advance, so this
   * approaches completion asymptotically and deliberately never reaches 100 —
   * only the parsed result does that.
   */
  percent: number;
  elapsedMs: number;
}

/**
 * Roughly the JSON length of a mid-sized report, used only to shape the curve
 * above. Being wrong makes the bar move faster or slower, never incorrect.
 */
const EXPECTED_RESPONSE_CHARS = 24_000;

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatOutcome {
  /** What to show the user. */
  reply: string;
  /**
   * True only when the user is actually asking for a report to be built or
   * changed. Typing "hello" used to run a full generation, because every
   * message went straight to analyzeReportDesign; this is what separates
   * conversation from work.
   */
  wantsReport: boolean;
}

/**
 * Canned chat turn for VITE_FORMA_MOCK. The classification is keyword-based
 * rather than random so the mock behaves the same way twice — a build request
 * still falls through to generation, and small talk still does not.
 */
function buildMockChatReply(userText: string): ChatOutcome {
  const asks = /\b(build|create|generate|make|design|convert|turn|produce|draft)\b/i.test(userText);
  return {
    reply: asks
      ? "Mock mode is on, so I'm not calling Gemini — attach a design and I'll return the canned invoice layout."
      : "Mock mode is on, so this reply is canned rather than generated. Set VITE_FORMA_MOCK aside and add your API key for real answers.",
    wantsReport: false,
  };
}

/**
 * Models that answered a `thinkingBudget: 0` request with 400. Some reject the
 * field outright and the pro tiers refuse to let it reach zero, so support is
 * discovered rather than assumed — once per model per session.
 */
const thinkingUnsupportedForModel = new Set<string>();

/**
 * Turn a provider error into something worth showing a person.
 *
 * These errors routinely arrive with the whole upstream JSON envelope stuffed
 * into `.message`, sometimes nested twice, which renders as a wall of braces
 * and escaped newlines in the UI.
 *
 * Exported for tests.
 */
export function asReadableError(error: any): Error {
  if (error?.name === "AbortError") return error;

  let message = `${error?.message || ""}`.trim();

  // Unwrap as many nested {"error":{"message":...}} layers as are present.
  for (let depth = 0; depth < 3; depth++) {
    const braceAt = message.indexOf("{");
    if (braceAt === -1) break;
    try {
      const parsed = JSON.parse(message.slice(braceAt));
      const inner = parsed?.error?.message ?? parsed?.message;
      if (typeof inner !== "string" || !inner.trim()) break;
      message = inner.trim();
    } catch {
      break;
    }
  }

  if (!message) message = "The request failed.";
  return new Error(message);
}

/**
 * Pull the `reply` string out of a partially-received JSON object.
 *
 * The response is schema-constrained JSON, so it cannot be `JSON.parse`d until
 * the final chunk. But `reply` is the first property, so its characters are on
 * the wire long before the object closes — this scans them out so the answer
 * can be typed into the UI as it arrives instead of appearing all at once.
 *
 * Exported for tests. Its contract — every possible chunk split yields a clean
 * prefix, never JSON punctuation and never a dangling escape — is invisible in
 * normal use and shows up as stray characters flickering in the chat bubble, so
 * it is pinned by a property test over every split point.
 */
export function extractPartialReply(json: string): string {
  const keyAt = json.indexOf('"reply"');
  if (keyAt === -1) return "";
  const colonAt = json.indexOf(":", keyAt + 7);
  if (colonAt === -1) return "";
  const openQuote = json.indexOf('"', colonAt + 1);
  if (openQuote === -1) return "";

  let out = "";
  for (let i = openQuote + 1; i < json.length; i++) {
    const ch = json[i];
    if (ch === "\\") {
      const next = json[i + 1];
      if (next === undefined) break; // escape split across chunks
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else out += next; // covers \" and \\
      i++;
      continue;
    }
    if (ch === '"') break; // closing quote — the reply is complete
    out += ch;
  }
  return out;
}

/**
 * Short conversational turn. Deliberately cheap: no images, no report schema,
 * a small output cap — it answers questions and decides whether the user is
 * asking for a report, nothing more.
 *
 * `onPartialReply` receives the answer as it streams, so the bubble fills in
 * progressively rather than after a silent wait.
 */
export async function chatReply(
  history: ChatTurn[],
  config?: ReportConfig,
  signal?: AbortSignal,
  onPartialReply?: (text: string) => void
): Promise<ChatOutcome> {
  if (signal?.aborted) throw abortError();

  const currentApiKey = config?.customApiKey?.trim();

  // Mock mode has to cover this path too. It only guarded analyzeReportDesign,
  // so with VITE_FORMA_MOCK set a plain text message still went to the network —
  // one request per model candidate — which is exactly what the flag exists to
  // avoid, and made the flag useless for demoing or testing chat offline.
  if (viteEnv.VITE_FORMA_MOCK === "true") {
    console.warn("VITE_FORMA_MOCK is set — answering from the mock chat reply without calling Gemini.");
    const lastUserTurn = [...history].reverse().find((t) => t.role === 'user')?.text ?? '';
    const mock = buildMockChatReply(lastUserTurn);
    // Typed out rather than delivered whole, so the progressive-display path is
    // exercised under the flag instead of being skipped.
    if (onPartialReply) {
      for (let i = 1; i <= mock.reply.length; i += 3) {
        await sleep(20, signal);
        onPartialReply(mock.reply.slice(0, i));
      }
    }
    await sleep(200, signal);
    return mock;
  }

  if (!currentApiKey) throw new MissingApiKeyError();

  // Loaded here, not imported at the top: the SDK is only reachable from this
  // function and chatReply, and both refuse above if there is no key. See
  // src/lib/genai.ts.
  const { GoogleGenAI, Type } = await loadGenAI();
  const ai = new GoogleGenAI({ apiKey: currentApiKey });
  const model = config?.modelName?.trim() || (await resolveModel(currentApiKey, signal));

  const transcript = history
    .slice(-10) // recent context is enough, and keeps the call small
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
    .join('\n');

  const startedAt = Date.now();

  const buildChatRequest = (disableThinking: boolean) => ({
    model,
    contents: [
      {
        parts: [
          {
            text: `You are the assistant inside Forma, a tool that turns an uploaded design (image, PDF or .repx) into a DevExpress report layout and a downloadable .repx file.

Answer the user's message briefly and helpfully — two or three sentences at most. You can explain what Forma does, how to use it, what DevExpress reports are, and what file types are supported.

Set "wantsReport" to true ONLY when the user is genuinely asking you to build or modify a report right now, and has given enough to work from — either they describe a report they want created, or they are asking for a change to a report that already exists. Greetings, questions, thanks, and vague statements are NOT report requests.

If they clearly want a report but have not supplied a design or a description, set "wantsReport" to false and ask them to attach an image or PDF, or describe the layout they want.

Never claim to have generated anything. You do not generate reports — you only reply and decide.

Conversation so far:
${transcript}`,
          },
        ],
      },
    ],
    config: {
      abortSignal: signal,
      temperature: 0.4,
      maxOutputTokens: 512,
      // Chat is a two-or-three sentence answer plus a yes/no classification.
      // These models otherwise reason silently before writing a single
      // character, which for "hello" is the entire wait — and it is timed and
      // billed exactly like output. Disabled here, and only here: report
      // generation is a genuinely hard spatial task and keeps its default.
      //
      // Not every model accepts this, though: some reject thinkingBudget
      // outright and some (the pro tiers) refuse to let it reach zero, both
      // with a bare 400 INVALID_ARGUMENT. Hence the fallback below rather than
      // sending it unconditionally.
      ...(disableThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reply: { type: Type.STRING },
          wantsReport: { type: Type.BOOLEAN },
        },
        required: ['reply', 'wantsReport'],
      },
    },
  });

  let stream;
  const attemptWithoutThinking = !thinkingUnsupportedForModel.has(model);

  try {
    stream = await ai.models.generateContentStream(buildChatRequest(attemptWithoutThinking));
  } catch (err: any) {
    const invalidArgument =
      err?.status === 400 ||
      `${err?.message || ""}`.includes("INVALID_ARGUMENT") ||
      `${err?.message || ""}`.includes("invalid argument");

    if (attemptWithoutThinking && invalidArgument && !signal?.aborted) {
      // Remember for the rest of the session so this costs one failed request
      // per model, not one per message.
      thinkingUnsupportedForModel.add(model);
      console.warn(
        `Model "${model}" rejected thinkingBudget:0 — retrying without it. ` +
        `Chat replies will be slower on this model.`
      );
      stream = await ai.models.generateContentStream(buildChatRequest(false));
    } else {
      throw asReadableError(err);
    }
  }

  let raw = '';
  let lastEmitted = '';
  let firstChunkAt = 0;

  try {
  for await (const chunk of stream) {
    if (signal?.aborted) throw abortError();
    if (!chunk.text) continue;
    if (!firstChunkAt) firstChunkAt = Date.now();

    raw += chunk.text;

    // Type the answer out as it arrives. Emitting only on change keeps this
    // from re-rendering on chunks that carried nothing but JSON punctuation.
    if (onPartialReply) {
      const partial = extractPartialReply(raw);
      if (partial && partial !== lastEmitted) {
        lastEmitted = partial;
        onPartialReply(partial);
      }
    }
  }
  } catch (err: any) {
    // Mid-stream failures carry the same nested JSON envelope as the initial
    // request, so they get the same treatment. Cancellation passes through.
    if (signal?.aborted || err?.name === 'AbortError') throw err;
    throw asReadableError(err);
  }

  console.debug(
    `Chat reply — ${firstChunkAt ? firstChunkAt - startedAt : 0}ms to first token, ` +
    `${Date.now() - startedAt}ms total.`
  );

  raw = raw.trim();
  if (!raw) throw new Error('The assistant did not respond. Try again.');

  try {
    const parsed = JSON.parse(raw) as ChatOutcome;
    return {
      reply: parsed.reply || 'Sorry — I did not catch that.',
      wantsReport: Boolean(parsed.wantsReport),
    };
  } catch {
    // Never show the user raw JSON if the object arrived malformed — the
    // scanner above already has a usable answer in most cases.
    const salvaged = extractPartialReply(raw);
    return { reply: salvaged || raw, wantsReport: false };
  }
}

/**
 * What gets attached to the request: page images, plus any text recovered from
 * the file itself (a PDF's text layer, an uploaded .repx). Text parts carry
 * exact strings and coordinates and are far more reliable than reading the
 * same thing back out of pixels, so the prompt tells the model to prefer them.
 */
/* The type itself now lives in ../lib/reportTypes.ts and is re-exported at the
   top of this file; `toAttachmentParts` in lib/ builds these, so it could not
   keep importing the shape from here. */

export async function analyzeReportDesign(
  prompt: string,
  imageParts: AttachmentPart[],
  config?: ReportConfig,
  previousState?: { layout?: ReportLayout; repxContent?: string },
  signal?: AbortSignal,
  onProgress?: (progress: StreamProgress) => void
): Promise<AnalysisResponse> {
  // Cancelled before we even started — don't spend a request on it.
  if (signal?.aborted) throw abortError();

  const currentApiKey = config?.customApiKey?.trim();

  // Mock mode is now opt-in via VITE_FORMA_MOCK=true, for exercising loaders
  // without spending a request. It used to trigger whenever the key was missing
  // *or* the prompt merely contained the word "mock" — so a first-time visitor
  // with no key, or anyone asking to "mock up an invoice", silently received a
  // canned fake report and had no way to tell it was not real output.
  if (viteEnv.VITE_FORMA_MOCK === "true") {
    console.warn("VITE_FORMA_MOCK is set — returning the mock invoice layout without calling Gemini.");
    // Simulate a 3-second network delay to allow testing loaders and status bars
    await sleep(3000, signal);
    return MOCK_INVOICE_RESPONSE;
  }

  // No key means no request. Surfaced as a distinct type so the caller can open
  // the config modal rather than showing a generic failure.
  if (!currentApiKey) {
    throw new MissingApiKeyError();
  }

  /**
   * The version the ROOT STRUCTURE example is built with.
   *
   * That example used to hardcode 23.2.3.0 while CRITICAL CONFIGURATION stated
   * the chosen version *below* it — so the model copied the example and every
   * generation came out 23.2 whatever the dropdown said. A .repx is rejected by
   * an older designer than the one it declares, which made the setting look
   * present and do nothing.
   *
   * `X.Y.3.0` is the shape both observed real files use: Forma's own output
   * (23.2.3.0) and a template written by an installed 20.1 designer (20.1.3.0).
   * If a build number ever has to be exact, it belongs in a map keyed by version
   * rather than here.
   */
  const targetVersion = config?.version || '23.2';
  const targetSerializerVersion = `${targetVersion}.3.0`;

  /**
   * The page the model is told to map onto, derived rather than hardcoded.
   *
   * `PageWidth="850" PageHeight="1100"` and "a standard 8.5x11 page is 850x1100"
   * were both literals in this prompt while the config dialog offered A4 and
   * Legal, and `configInstructions` separately told the model to "adjust page
   * dimensions accordingly" — three instructions, two of them contradicting the
   * user's own setting. `FeaturesPage` advertises "written into the XML along
   * with the margins, so the sheet you review and the sheet that prints are the
   * same size", which was simply not true for two of the three options.
   */
  // Resolved, not taken as given. These two strings are written verbatim into
  // the REPX — `ReportUnit="${reportUnit}"` below — so an unrecognised one does
  // not merely mis-scale the geometry, it lands in the XML and DevExpress
  // refuses the file. `config.unit || 'HundredthsOfAnInch'` passed anything
  // non-empty straight through (audit BUG-001).
  const reportUnit = resolveReportUnit(config?.unit);
  const pageSize = resolvePageSize(config?.pageSize);
  const page = pageSizeInUnits(pageSize, reportUnit);
  const unitsPerInchForReport = unitsPerInch(reportUnit);

  /* A real band skeleton — ReportHeader / PageHeader / a ONE-ROW Detail /
     ReportFooter / PageFooter — rather than one page-sized DetailBand, which
     printed the whole page once per record the moment a data source was bound.
     VITE_FORMA_FLAT=true asks for the old shape back; see lib/reportBands.ts for
     why the fallback still exists and what depends on this text. */
  const useBandedLayout = !flatLayoutEnabled(viteEnv);

  // Anchors for the font-size rule in the prompt. Ordinary printed body text is
  // 9-11pt; expressed in the layout's own unit it becomes a range the model can
  // check its own answer against, which is the only defence against the whole
  // report coming out uniformly small. See "The fonts were measured off the
  // ink" in docs/notes/gemini.md.
  const bodyFontMinUnits = Math.round(pointsToUnits(9, reportUnit));
  const bodyFontMaxUnits = Math.round(pointsToUnits(11, reportUnit));

  const configInstructions = config ? `
  CRITICAL CONFIGURATION:
  - DevExpress Version: ${config.version}
  - PaperKind: ${pageSize}. The exact PageWidth/PageHeight/ReportUnit values are given in the ROOT STRUCTURE above and are already correct for this paper — use them verbatim rather than recomputing them.
  ${config.header ? `
  - HEADER:
    - Include Company Logo: ${config.header.showCompanyLogo ? 'Yes' : 'No'}
    - Report Title: ${config.header.title || 'None'}
  ` : ''}
  ${config.footer ? `
  - FOOTER:
    - Include Page Numbers: ${config.footer.showPageNumbers ? 'Yes' : 'No'}
    - Custom Footer Text: ${config.footer.customText || 'None'}
  ` : ''}
  ${config.rtl ? `
  - LOCALIZATION:
    - Set RightToLeft="Yes" and RightToLeftLayout="Yes" on the main report component for Arabic/RTL support.
  ` : ''}
  ${config.spName ? `
  - DATA SOURCE:
    - Assume the data source is populated via the Stored Procedure: "${config.spName}".
  ` : ''}
  ${config.dataSchema ? `
  - DATA BINDING SCHEMA:
    - Use the following JSON data schema to generate proper DevExpress Data Bindings (ExpressionBindings, ComponentStorage, SqlDataSource, or ObjectDataSource).
    - Map the schema properties to the respective report controls.
    - Schema: ${config.dataSchema}
  ` : ''}
  - C# INTEGRATION: Name key dynamic labels with standard IDs (e.g., "label1", "label2", "label6") so they can be easily manipulated via C# code (e.g., report.AllControls<XRControl>().FirstOrDefault(x => x.Name == "label1")).
  Make sure the generated REPX XML strictly adhering to these settings.
  ` : '';

  const previousContext = previousState ? `
  PREVIOUS REPORT STATE:
  You are modifying an existing report. Here is the current layout structure:
  ${JSON.stringify(previousState.layout, null, 2)}
  
  And the current REPX XML:
  ${previousState.repxContent}
  
  CRITICAL: You MUST preserve the entire existing structure from the PREVIOUS REPORT STATE. Only modify the specific parts requested in the USER INSTRUCTIONS. Do NOT remove sections, tables, or fields unless explicitly told to do so.
  ` : '';

  // config.modelName is an internal escape hatch with no UI — a self-hoster can
  // pin a model in code. Left unset (the normal case) the model is detected.
  // Timing breakdown. Total wall-clock alone could not distinguish "model
  // detection was slow", "the upload was slow" and "the model wrote a lot of
  // XML", which are three different problems with three different fixes.
  const tStart = Date.now();
  const inlineBytes = imageParts.reduce(
    (sum, p) => sum + (('inlineData' in p ? p.inlineData?.data?.length : 0) || 0),
    0
  );
  if (inlineBytes) {
    console.debug(`Attachments: ${imageParts.length} part(s), ~${Math.round(inlineBytes / 1024)} KB base64.`);
  }

  const pinnedModel = config?.modelName?.trim();
  let selectedModel = pinnedModel || (await resolveModel(currentApiKey, signal));
  const tResolved = Date.now();

  // Loaded here, not imported at the top: the SDK is only reachable from this
  // function and chatReply, and both refuse above if there is no key. See
  // src/lib/genai.ts.
  const { GoogleGenAI, Type } = await loadGenAI();
  const ai = new GoogleGenAI({ apiKey: currentApiKey });

  console.debug(`Initializing Gemini model with API key...`);
  console.log(`Sending request to AI model: ${selectedModel}`);

  /**
   * Streamed request. The response is one JSON object constrained by
   * responseSchema, so it cannot be parsed until the last chunk lands — but
   * the chunks still tell us the model is working and roughly how much it has
   * written. That turns the progress bar from a 2.5s timer that invented its
   * own percentages into something driven by real output.
   */
  const requestFor = async (modelName: string): Promise<{ text: string; finishReason?: string }> => {
    const stream = await ai.models.generateContentStream(buildRequest(modelName));

    let text = '';
    let finishReason: string | undefined;
    let lastEmit = 0;
    const streamStarted = Date.now();

    // Time to the first chunk is the single most diagnostic number here. These
    // models think before they write, and thinking is billed and timed like
    // output while producing nothing visible. A long gap before the first
    // chunk means thinking; a short gap followed by a long tail means the
    // report is simply large. The two have completely different remedies.
    let firstChunkAt = 0;
    let usage: any;

    for await (const chunk of stream) {
      // The SDK honours config.abortSignal, but checking here as well tears the
      // loop down promptly rather than waiting on the next chunk.
      if (signal?.aborted) throw abortError();

      if (chunk.text) {
        if (!firstChunkAt) firstChunkAt = Date.now();
        text += chunk.text;
      }

      // Usage arrives on the final chunks; keep the newest non-empty one.
      if (chunk.usageMetadata) usage = chunk.usageMetadata;

      const reason = chunk.candidates?.[0]?.finishReason;
      if (reason) finishReason = reason;

      // Throttled: chunks can arrive far faster than the UI needs to repaint.
      const now = Date.now();
      if (onProgress && now - lastEmit >= 120) {
        lastEmit = now;
        onProgress({
          chars: text.length,
          percent: Math.min(95, Math.round(100 * (1 - Math.exp(-text.length / EXPECTED_RESPONSE_CHARS)))),
          elapsedMs: now - streamStarted,
        });
      }
    }

    const waited = firstChunkAt ? firstChunkAt - streamStarted : 0;
    const wrote = firstChunkAt ? Date.now() - firstChunkAt : 0;
    console.log(
      `Stream breakdown — waited ${waited}ms before first output, wrote for ${wrote}ms, ` +
      `${text.length} chars.`
    );
    if (usage) {
      console.log(
        `Token usage — input ${usage.promptTokenCount ?? "?"}, ` +
        `output ${usage.candidatesTokenCount ?? "?"}, ` +
        `thinking ${usage.thoughtsTokenCount ?? 0}, ` +
        `total ${usage.totalTokenCount ?? "?"}.`
      );
      if ((usage.thoughtsTokenCount ?? 0) > 0) {
        console.warn(
          `${usage.thoughtsTokenCount} thinking tokens were generated before any visible output. ` +
          `Thinking is timed and billed like output. If this number is large, capping it via ` +
          `config.thinkingBudget is the biggest available latency lever.`
        );
      }
    }

    return { text, finishReason };
  };

  const buildRequest = (modelName: string) => ({
    model: modelName,
    contents: [
      {
        parts: [
          { text: `You are an expert DevExpress Report Designer. 
          
          YOUR PRIMARY GOAL: EXACT PIXEL-PERFECT UI MATCH.
          You must meticulously analyze the provided image(s) and recreate the EXACT layout, including every single table, column, row, label, border, and image placeholder. Do not skip any details. The generated REPX XML and layout JSON must be a 1:1 representation of the visual structure in the image.

          SOURCE PRECEDENCE — READ THIS FIRST.
          Some attachments are text extracted directly from the uploaded file rather than read from an image: a PDF's own text layer, or the contents of an existing .repx. Where such text is provided it is EXACT and comes from the file itself.
          - Use those strings verbatim for Text= values. Do NOT re-read, re-spell or "correct" them from the page image.
          - Use their x/y/w/h numbers as the basis for LocationFloat and SizeF. They are already in this report's units (${reportUnit}, ${unitsPerInchForReport} per inch) with the origin at the top-left, so they need no conversion.
          - **An extracted string's h is its font's em size, read out of the file — so it is that string's EXACT font size as well as its height.** Use it for that element's "fontSize" verbatim and do NOT re-estimate the size from the page image; convert it to points for Font= with the arithmetic under FONT SIZE IS ALWAYS IN POINTS. (An h of 0 means the extractor could not size that one string — only then read it from the image.)
          - Use the page image for what the text layer cannot express: borders, rules, fills, logos, images, alignment and overall visual structure.
          - If the image and the extracted text disagree about a string or a position, the extracted text wins.
          - When an existing .repx is supplied, treat it as the base structure and preserve it, applying only the changes the user asks for.

          PHASE 1: SPATIAL MAPPING
          Before generating the output, list elements and their exact coordinates and sizes (X, Y, Width, Height) in the markdown section.
          - The report unit is ${reportUnit}: 1 inch = ${unitsPerInchForReport} units.
          - The page is ${pageSize}: ${page.width} x ${page.height} units.
          - The origin (0,0) is the TOP-LEFT CORNER OF THE PAPER, not of any margin or content area.
          - Map the visual proportions perfectly to this grid.
          - Find the repeating structures BEFORE you list anything. A region whose rows share the same column positions is ONE element — a table with rows and columns — and is listed once as such, never as one entry per cell. See "AN ALIGNED, REPEATING REGION IS A TABLE" below for what counts and why it matters.
          - The design's own whitespace is part of the design. If the artwork begins an inch in from the paper edge, its first element is at x=${Math.round(unitsPerInchForReport)}, and you must NOT also add a page margin — that would move it in twice.

          PHASE 2: DEVEXPRESS CHEAT SHEET (STRICT SYNTAX)
          When generating the "repxContent" XML, you MUST use these exact structures:
          
${rootStructurePrompt({ page, reportUnit, targetVersion, targetSerializerVersion }, useBandedLayout)}
          - Labels: <Item1 Ref="1" ControlType="XRLabel" Name="label1" Text="My Text" LocationFloat="0,10" SizeF="200,30" Padding="2,2,0,0,100" />
          - Tables — rows and cells, with cells sized by Weight and never by coordinates: <Item2 Ref="2" ControlType="XRTable" Name="table1" LocationFloat="0,50" SizeF="750,40" Borders="All"><Rows><Item1 Ref="3" ControlType="XRTableRow" Name="rowHeader" Weight="1"><Cells><Item1 Ref="4" ControlType="XRTableCell" Name="cellHeadDesc" Text="Description" Weight="3" Font="Arial, 9.75pt, style=Bold" /><Item2 Ref="5" ControlType="XRTableCell" Name="cellHeadAmount" Text="Amount" Weight="1" TextAlignment="MiddleRight" Font="Arial, 9.75pt, style=Bold" /></Cells></Item1><Item2 Ref="6" ControlType="XRTableRow" Name="row1" Weight="1"><Cells><Item1 Ref="7" ControlType="XRTableCell" Name="cellDesc1" Text="Widget" Weight="3" /><Item2 Ref="8" ControlType="XRTableCell" Name="cellAmount1" Text="1,240.00" Weight="1" TextAlignment="MiddleRight" /></Cells></Item2></Rows></Item2>
          - Images: <Item3 Ref="5" ControlType="XRPictureBox" Name="pictureBox1" Sizing="ZoomImage" LocationFloat="0,100" SizeF="150,150" />
          - Lines: <Item4 Ref="6" ControlType="XRLine" Name="line1" LocationFloat="0,260" SizeF="300,5" />
          - Page Info: <Item5 Ref="7" ControlType="XRPageInfo" Name="pageInfo1" PageInfo="DateTime" LocationFloat="0,270" SizeF="150,20" />
          - Barcode: <Item6 Ref="8" ControlType="XRBarCode" Name="barcode1" LocationFloat="0,300" SizeF="200,50"><Symbology Name="Code128" /></Item6>
          Always use standard DevExpress.XtraReports.UI components. Ensure LocationFloat and SizeF use comma without spaces for numbers (e.g. "150.5,20.3").

          - AN ALIGNED, REPEATING REGION IS A TABLE. FINDING IT IS PART OF THE JOB.
            Before you place a single label, look for the repeating structures. Wherever two or more rows share the same column positions, that region is a table — line items, schedules, price lists, specification grids, timesheets, statements, any list of things with the same fields. Emit it as real XRTable / XRTableRow / XRTableCell structure; how many of its rows go into repxContent is settled at the end of this block.
            - **Visible rules are not required, and their absence is not evidence.** Columns that line up are the signal. A region drawn with no borders at all is still a table; so is one separated only by a single rule under the headings.
            - **A grid of XRLabels is always the wrong answer for such a region**, however exactly its coordinates match the source. It looks identical in a preview and is a failed report: those columns cannot be re-bound to data, resized, or repeated per record, which is the whole purpose of the file being a .repx instead of a picture.
            - Column widths are relative Weight values on the cells, not coordinates — a column twice as wide as its neighbour gets twice the Weight. **An XRTableCell has no LocationFloat and no SizeF**; do not compute them. The XRTable's own SizeF sets the width the weights are distributed across.
            - Carry the source's own formatting onto the cells: bold the header row, and give money, quantity and date columns a TextAlignment ending in Right if that is how they are set.
            - ${tableRowsRule(useBandedLayout)}
            - The same region must be ONE "type": "table" element in the layout JSON, carrying the same rows and cells — see TABLES / GRIDS IN THE LAYOUT below. The two artifacts describe one report and must agree about where its tables are.

          - APPEARANCE IS PART OF THE REPORT, NOT JUST OF THE PREVIEW.
            Every visual property you put in the "layout" JSON must also appear on the matching control in repxContent. A .repx that has the right boxes in the right places but default styling is a failed reproduction — it is the file the user actually opens and prints.
            - Font: <Font>Arial, 9.75pt, style=Bold</Font> as a child element, or Font="Arial, 9.75pt" as an attribute. Styles: style=Bold, style=Italic, style=Bold, Italic.
            - **FONT SIZE IS ALWAYS IN POINTS (1/72"), NEVER IN REPORT UNITS.** It is one of exactly TWO things in the file that do not follow ReportUnit — the other is BorderWidth, below. Convert: points = layoutFontSize * 72 / ${unitsPerInchForReport}. A layout fontSize of 16 is ${(unitsToPoints(16, reportUnit)).toFixed(2)}pt, NOT 16pt. Writing the layout number straight into the Font makes every piece of text far too large while both files still look internally consistent.
            - ForeColor="Black" or ForeColor="#1A2B3C" for text colour; BackColor for fills. Omit BackColor entirely when the area is white or transparent — do not paint every control white.
            - TextAlignment="TopLeft" | "MiddleCenter" | "MiddleRight" | "BottomLeft" etc. — it combines the vertical and horizontal alignment from the layout into one value. Numeric and currency columns are almost always a *Right variant.
            - Borders="None" | "All" | "Top, Bottom" | "Left, Right" (comma-separated sides), plus BorderColor="#RRGGBB" and BorderWidth="1" when the rule is not a hairline black. A heading underlined by a rule is Borders="Bottom", NOT Borders="All".
            - **BORDERWIDTH IS ALWAYS IN PIXELS, NEVER IN REPORT UNITS.** This is the second exception to ReportUnit, alongside font size. Write the pixel count you would use on screen — a hairline is BorderWidth="1" and a heavy rule is "2" or "3" — and do NOT scale it into ${reportUnit}. Scaling it the way you scale LocationFloat would turn a 1px rule into ${(unitsPerInchForReport / 96).toFixed(2)}, which is then read back as that many PIXELS and prints ${(unitsPerInchForReport / 96).toFixed(1)}x too thick.
            - WordWrap="false" on single-line labels so they clip instead of reflowing, matching the "wrap" flag in the layout.
            - RightToLeft="Yes" on a control only if the report itself is RTL.

          ${configInstructions}
          ${previousContext}
          
          Return a JSON object with three fields:
          1. "markdown": A detailed written report specification (description, components, styles).
          2. "layout": A structured representation of the visual layout for a UI preview mockup.
          3. "repxContent": A complete, valid DevExpress REPX XML string representing the full report layout. Use standard DevExpress.XtraReports.UI components (Bands, XRLabel, XRTable, XRPictureBox, etc.).
          
          CRITICAL XML VALIDITY RULES FOR repxContent:
          - The repxContent MUST be strictly valid XML.
          - **EVERY Ref VALUE IN THE DOCUMENT MUST BE DIFFERENT.** Number them once, straight through, from Ref="0" on the root: 0, 1, 2, 3 ... to the last element, counting bands, controls, rows and cells as one single sequence. Do NOT restart numbering inside a band, a table or a row, and do NOT copy the Ref numbers out of the examples below — those examples each start again from a low number and are NOT a numbering scheme for the whole file. DevExpress reads Ref as the identity of an object, so two elements sharing one value are loaded as ONE object and the second element's content is DISCARDED SILENTLY: the report opens with no error and controls missing.
          - ALL XML attribute values MUST be enclosed in double quotes (e.g., Text="My Label").
          - NEVER leave a string unclosed. Check every single quote.
          - If you need to use quotes, angle brackets, or ampersands inside an attribute value, use proper XML entities (e.g., &quot;, &apos;, &lt;, &gt;, &amp;).
          - Ensure all XML tags are properly closed.
          - Do NOT include markdown formatting (like \`\`\`xml) inside the repxContent string itself, just the raw XML.
          - DEVEXPRESS EXPRESSIONS & STRINGS: If you use DevExpress Expressions (<ExpressionBindings><Item1 Expression="..."/></ExpressionBindings>), any string literals inside the expression MUST be enclosed in single quotes.
          - CRITICAL XML ESCAPING: If a string literal inside an expression contains a single quote (like "Don't"), you MUST escape it by doubling the single quote (e.g., Expression="'Don''t do this'"). BUT YOU MUST ALSO escape the outer XML double quotes and special characters like &lt; and &gt;.
          - If the user provides a barcode, use ControlType="XRBarCode". For Lines, use ControlType="XRLine".
          - EXACT COMPLETENESS: Do not skip ANY table cells, labels, or elements to save tokens. The output must be 100% complete and exhaustive.
          
          The "layout" JSON must follow this structure. Its x, y, width and height are in the SAME ${reportUnit} units as the REPX, and are measured from the TOP-LEFT OF THEIR OWN SECTION — exactly like a control's LocationFloat inside its band, so the two artifacts carry the same numbers. "pageWidth" must be ${page.width}, matching the ROOT STRUCTURE.
          {
            "title": "Report Title",
            "pageWidth": ${page.width},
            "sections": [
              {
                "id": "section-1",
                "name": "Section Name",
                "type": "header" | "detail" | "footer" | "group",
                "height": 150,
                "elements": [
                  { "id": "el-1", "type": "label" | "table" | "chart" | "gauge" | "image" | "line" | "barcode", "content": "Text or description", "x": 10, "y": 10, "width": 200, "height": 30, "color": "#000000", "backgroundColor": "#ffffff", "fontSize": 12 }
                ]
              }
            ]
          }

          LAYOUT VISUAL FIDELITY — THE MOCKUP IS RENDERED DIRECTLY FROM THIS JSON.
          The "layout" is drawn on screen exactly as you describe it, so it must be a faithful visual copy of the source design, not a rough approximation. Fill in these optional fields on every element wherever the source shows them:
          - "bold": true for any heavier/darker text — titles, column headings, totals. Do not guess; set it when the text is visibly heavier than body text.
          - "italic": true for slanted text.
          - "fontFamily": the closest family name you can identify, e.g. "Arial", "Times New Roman", "Courier New".
          - "fontSize": the font's EM SIZE, in the same units as the rest of the layout — the number you would type into a font dialog, NOT the measured height of the letters. **This is the single most common way a reproduction comes out uniformly small.** Capital letters stand only about 70% of the em size and lowercase about half of it, so a heading whose capitals measure 21 units is a 30-unit font, not a 21-unit one. Measure it one of these two ways rather than off the ink:
            - Baseline to baseline of two consecutive lines in the same paragraph is 1.15-1.25x the font size. Divide.
            - Or measure the height of a capital letter and divide by 0.7.
            Then CHECK THE ANSWER before you use it: ordinary body text in a printed business document is 9-11pt, which is ${bodyFontMinUnits}-${bodyFontMaxUnits} in these units. If the body text you have measured comes out below that, you have measured the ink and EVERY size in the report is small by the same fraction — scale them all up together, keeping their ratios. Match those ratios carefully too: a title must be visibly larger than body text.
          - "color" and "backgroundColor": real hex values sampled from the design. Omit backgroundColor entirely when the area is plain white/transparent — do NOT emit "#ffffff" for everything.
          - "textAlign" and "verticalAlign": how the text sits inside its own box. Numeric/currency columns are almost always "right".
          - "wrap": true when the text runs onto more than one line in the source. Leave it false for single-line text so it clips instead of reflowing.
          - Borders: use "borderTop" / "borderRight" / "borderBottom" / "borderLeft" individually. A heading underlined by a rule is "borderBottom": true — NOT a full box. Only use "hasBorder": true when all four sides are genuinely drawn. Set "borderColor" when the rule is not black.

          TABLES / GRIDS IN THE LAYOUT — emit real structure, not decomposed labels.
          For any grid, use a single element with "type": "table" and fill its "rows" array. Each row has "cells", and each cell has "content" plus optional "weight", "bold", "textAlign", "color", "backgroundColor". Mark heading rows with "isHeader": true. Use "weight" to express relative column widths and row heights (a column twice as wide as its neighbour gets twice the weight) — the renderer distributes them across the element's box, so you do NOT need to compute per-cell x/y coordinates. Reproduce EVERY row and EVERY column you can see, including the header row and any totals row. Do not invent placeholder rows and do not truncate long tables.

          IMAGES AND LOGOS — detect each picture and return its bounding box.
          FIRST, count the pictures. Scan the whole design and identify EVERY distinct piece of artwork separately: company logo, product photos, signatures, stamps, icons, QR/graphic marks. A design with four pictures must produce FOUR separate "image" elements, each positioned at its own x/y/width/height.

          For each image element, perform OBJECT DETECTION on the supplied page image and return "box2d" — the 2D bounding box of THAT ONE picture, in your standard detection format:

            "box2d": [ymin, xmin, ymax, xmax]

          with all four values normalised to the 0-1000 range of the image, y before x, top-left origin. This is exactly the bounding-box format you use for object detection; produce it the same way here. Add "sourceImageIndex" when more than one file was supplied (0 = first).

          Worked example — a logo in the top-left eighth of the page: "box2d": [30, 50, 110, 230].

          These rules are strict, because a wrong box is worse than none:
          - The box must TIGHTLY bound that single picture — its own edges, nothing else. No surrounding whitespace, captions, borders, or neighbouring content.
          - NEVER return the whole frame. [0, 0, 1000, 1000] is always wrong, and so is any box covering most of the page. You are locating one picture inside the design, not describing the design.
          - Every image element must have a DIFFERENT box. Two pictures must never share one, and boxes must not overlap.
          - The box's shape must match the element's own shape. A square logo drawn at width 80 height 80 needs a roughly square box, not a full-width strip.
          - If you cannot locate a specific picture confidently, OMIT "box2d" for that element but KEEP the element. An element with no box renders as a clean placeholder, which is correct and expected. A box covering the wrong area renders the entire design squashed into one small box, which is a visible defect.

          Omit "box2d" entirely when the element is not present in any supplied image (for instance a placeholder you were asked to add).

          CHARTS — set "chartType" to "bar", "line", "pie" or "area" to match the source, and put the approximate series values in "chartValues" so the drawn chart has the same shape as the original.
          - EXACT XML COMPLETENESS: The repxContent MUST be fully comprehensive. Do NOT skip sections, do NOT omit fields, do NOT output generic XML.
          - DEVEXPRESS TABLES: every region identified under "AN ALIGNED, REPEATING REGION IS A TABLE" above MUST be a proper DevExpress \`<XRTable>\` / \`<XRTableRow>\` / \`<XRTableCell>\` in the XML, never a grid of labels. Position and size the \`<XRTable>\` itself with LocationFloat and SizeF so it covers the same box as the source; the rows and cells inside it take neither, only \`Weight\`. Use \`Borders="All"\` on the table when the source rules every cell, and the individual border sides when it does not.
          - LOCATIONS AND SIZES: Make **absolute sure** that components do not overlap incorrectly. Calculate the X and Y bounds correctly. LocationFloat expects X,Y and SizeF expects Width,Height. Do NOT add spaces after the comma.
          - PREVIEW MOCKUP ACCURACY: In the JSON \`layout\`, represent every grid as ONE \`"table"\` element with a populated \`rows\`/\`cells\` array, as described under "TABLES / GRIDS IN THE LAYOUT" above. (Earlier revisions asked for grids to be decomposed into one \`"label"\` per cell because the preview could not draw real tables. It can now, so emit the real structure — it is both more accurate and far less error-prone than hand-computing every cell coordinate.)

          USER INSTRUCTIONS / CHAT REQUEST: 
          "${prompt}"
          
          CRITICAL INSTRUCTION HANDLING:
          1. FIRST, build the complete, pixel-perfect base layout from the image(s) or the PREVIOUS REPORT STATE.
          2. THEN, apply the USER INSTRUCTIONS as specific modifications (additions, deletions, style changes) to that base layout.
          3. NEVER discard the rest of the report structure just because the user asked for a specific change. The final output MUST contain the full report with the user's changes applied on top.` },
          ...imageParts,
        ],
      },
    ],
    config: {
      // Cancels the in-flight fetch when the user pauses or stops. Client-side
      // only: the service may still finish the generation and bill for it.
      abortSignal: signal,
      temperature: 0,
      maxOutputTokens: 65536,
      // Omitted entirely unless explicitly set, so the model keeps its own
      // default. See ReportConfig.thinkingBudget.
      ...(typeof config?.thinkingBudget === "number"
        ? { thinkingConfig: { thinkingBudget: config.thinkingBudget } }
        : {}),
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          markdown: { type: Type.STRING },
          repxContent: { type: Type.STRING },
          layout: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              pageWidth: { type: Type.NUMBER },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    name: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["header", "detail", "footer", "group"] },
                    height: { type: Type.NUMBER },
                    elements: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          type: { type: Type.STRING, enum: ["label", "table", "chart", "gauge", "image", "line", "barcode"] },
                          content: { type: Type.STRING },
                          x: { type: Type.NUMBER },
                          y: { type: Type.NUMBER },
                          width: { type: Type.NUMBER },
                          height: { type: Type.NUMBER },
                          color: { type: Type.STRING },
                          backgroundColor: { type: Type.STRING },
                          fontSize: { type: Type.NUMBER },
                          textAlign: { type: Type.STRING, enum: ["left", "center", "right"] },
                          hasBorder: { type: Type.BOOLEAN },
                          bold: { type: Type.BOOLEAN },
                          italic: { type: Type.BOOLEAN },
                          fontFamily: { type: Type.STRING },
                          verticalAlign: { type: Type.STRING, enum: ["top", "middle", "bottom"] },
                          wrap: { type: Type.BOOLEAN },
                          borderTop: { type: Type.BOOLEAN },
                          borderRight: { type: Type.BOOLEAN },
                          borderBottom: { type: Type.BOOLEAN },
                          borderLeft: { type: Type.BOOLEAN },
                          borderColor: { type: Type.STRING },
                          chartType: { type: Type.STRING, enum: ["bar", "line", "pie", "area"] },
                          chartValues: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                          sourceImageIndex: { type: Type.NUMBER },
                          box2d: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                          sourceRect: {
                            type: Type.OBJECT,
                            properties: {
                              x: { type: Type.NUMBER },
                              y: { type: Type.NUMBER },
                              width: { type: Type.NUMBER },
                              height: { type: Type.NUMBER }
                            },
                            required: ["x", "y", "width", "height"]
                          },
                          rows: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                weight: { type: Type.NUMBER },
                                isHeader: { type: Type.BOOLEAN },
                                cells: {
                                  type: Type.ARRAY,
                                  items: {
                                    type: Type.OBJECT,
                                    properties: {
                                      content: { type: Type.STRING },
                                      weight: { type: Type.NUMBER },
                                      bold: { type: Type.BOOLEAN },
                                      textAlign: { type: Type.STRING, enum: ["left", "center", "right"] },
                                      color: { type: Type.STRING },
                                      backgroundColor: { type: Type.STRING }
                                    },
                                    required: ["content"]
                                  }
                                }
                              },
                              required: ["cells"]
                            }
                          }
                        },
                        required: ["id", "type", "content", "x", "y", "width", "height"]
                      }
                    }
                  },
                  required: ["id", "name", "type", "height", "elements"]
                }
              }
            },
            required: ["title", "pageWidth", "sections"]
          }
        },
        required: ["markdown", "layout", "repxContent"]
      }
    }
  });

  /**
   * 503 / UNAVAILABLE means Google's capacity for this model is momentarily
   * exhausted. The generation never really started, nothing is wrong with the
   * key or the design, and the identical request usually succeeds moments
   * later — so retry it rather than making the user re-upload and re-run.
   */
  const isOverloaded = (error: any): boolean => {
    const status = error?.status;
    const text = `${error?.message || ""}`.toLowerCase();
    return (
      status === 503 ||
      status === "UNAVAILABLE" ||
      text.includes("503") ||
      text.includes("unavailable") ||
      text.includes("overloaded") ||
      text.includes("high demand")
    );
  };

  const MAX_OVERLOAD_RETRIES = 2;

  let response;
  let overloadAttempts = 0;
  let alreadyRedetected = false;
  /** Models that returned 503 until their retries ran out, in the order tried. */
  const overloadedModels: string[] = [];

  while (true) {
    try {
      response = await requestFor(selectedModel);
      break;
    } catch (error: any) {
      // Cancellation is never worth retrying.
      if (signal?.aborted || error?.name === "AbortError") throw toFriendlyError(error);

      // Transient capacity problem — back off and try the same model again.
      // sleep() rejects on abort, so pausing during the wait still tears down.
      if (isOverloaded(error) && overloadAttempts < MAX_OVERLOAD_RETRIES) {
        overloadAttempts++;
        // 2s, then 4s, plus jitter. The jitter matters more than it looks:
        // without it every tab that got a 503 in the same second retries in the
        // same second, which is how a busy model stays busy.
        const backoffMs = 2000 * overloadAttempts + Math.floor(Math.random() * 500);
        console.warn(
          `Model "${selectedModel}" is overloaded (503). Retrying in ${backoffMs}ms — attempt ${overloadAttempts} of ${MAX_OVERLOAD_RETRIES}.`
        );
        await sleep(backoffMs, signal);
        continue;
      }

      /**
       * Same model, out of retries. **A 503 is that model's capacity — not the
       * key's, not the request's** — so the next model this key can call is a
       * different pool and is usually free. Until 2026-08-26 this path just
       * gave up after ~6 seconds on one model while three or four perfectly
       * available alternatives sat in `MODEL_PREFERENCE`, already probed and
       * already known to work with this key. Switching is both faster and far
       * likelier to succeed than waiting longer on a model Google has just said
       * it has no room for.
       *
       * The fallback is **not** cached as the session's model: the preferred
       * model should be tried first again next time, once capacity returns.
       * `pinnedModel` opts out, for the same reason the 404 re-detect does — a
       * pinned id is an explicit instruction, not a default.
       */
      if (isOverloaded(error)) {
        overloadedModels.push(selectedModel);
        // The probed set when we have it. A tab that resolved its model before
        // this set was cached falls back to the raw preference list; if that
        // picks something the key cannot call, the 404 branch below re-detects
        // once and the loop carries on with an accurate set.
        const alternatives = pinnedModel ? [] : (readCachedModelSet() ?? MODEL_PREFERENCE);
        const next = alternatives.find((m) => !overloadedModels.includes(m));

        if (next) {
          console.warn(
            `Model "${selectedModel}" stayed overloaded after ${MAX_OVERLOAD_RETRIES} retries. ` +
            `Falling back to "${next}" for this request.`
          );
          selectedModel = next;
          overloadAttempts = 0;
          continue;
        }

        // Every model this key can use is busy. Say so, and name them — "try
        // again" reads very differently when the user can see it was not one
        // unlucky model.
        throw new Error(
          overloadedModels.length > 1
            ? `Google's servers are busy for every model this key can use — ${overloadedModels.join(", ")} ` +
              `were all tried and all returned "overloaded". This is capacity at Google's end: nothing is wrong ` +
              `with your API key or your design. Wait a minute or two and generate again.`
            : "Google's servers are busy and could not take this request, even after retrying. " +
              "Nothing is wrong with your API key or your design — wait a minute and generate again."
        );
      }

      // A model retired between sessions leaves a stale cached choice. Re-resolve
      // once and retry silently rather than making the user work it out. Skipped
      // when the model was pinned in code — that is an explicit instruction.
      const modelGone =
        error?.status === 404 || `${error?.message || ""}`.includes("NOT_FOUND");

      if (modelGone && !pinnedModel && !alreadyRedetected) {
        alreadyRedetected = true;
        console.warn(`Model "${selectedModel}" is no longer available — re-detecting.`);
        clearCachedModel();
        try {
          selectedModel = await resolveModel(currentApiKey, signal);
        } catch (retryError: any) {
          throw toFriendlyError(retryError);
        }
        console.log(`Retrying with: ${selectedModel}`);
        continue;
      }

      throw toFriendlyError(error);
    }
  }

  /** Maps an SDK error onto something a user can act on. Rethrows cancellations unwrapped. */
  function toFriendlyError(error: any): Error {
    // A cancelled request is not a failure — surface it unwrapped so callers can
    // tell "user pressed pause" apart from "the model errored".
    if (signal?.aborted || error?.name === "AbortError") {
      console.debug("Gemini request cancelled.");
      throw error?.name === "AbortError" ? error : abortError();
    }
    console.error("Error from AI model:", error);

    // The classification is in lib/geminiErrors.ts so it can be tested; only
    // the cancellation check above needs this closure's `signal`. The 400
    // branch in particular is load-bearing and was wrong until 2026-08-27 —
    // see the note in that file.
    return classifyGeminiError(error);
  }

  const tResponded = Date.now();
  console.log(
    `Generation timing — model detection ${tResolved - tStart}ms, ` +
    `request ${tResponded - tResolved}ms, total ${tResponded - tStart}ms ` +
    `(model: ${selectedModel}${overloadAttempts ? `, ${overloadAttempts} overload retry/retries` : ""}).`
  );

  console.debug(`Received raw response from Gemini. Parsing JSON...`);

  const rawText = response.text?.trim();

  // Diagnostics stay here, where the request context still exists; the decision
  // itself is in lib/analysisResponse.ts so it can be driven from fixtures. The
  // branch that matters — a truncated body is not a malformed one, and only
  // finishReason tells them apart — is documented there.
  if (!rawText) {
    console.error("Gemini returned an empty response. finishReason:", response.finishReason);
  }

  /**
   * Rewrite the REPX on its own, when the response finished but the XML did not.
   *
   * This is the quiet truncation: valid JSON, an intact `layout`, a readable
   * markdown spec, and a `repxContent` that stops mid-attribute. Everything the
   * app looks at says success, and the only broken artifact is the only one the
   * user opens in DevExpress. See `lib/repxTruncation.ts`.
   *
   * Three things make the second request likely to fit where the first did not,
   * and they are the reason this is a retry worth spending a request on rather
   * than the same roll of the dice:
   *
   * - It writes ONE artifact. No markdown specification, no layout JSON — both
   *   already exist and are correct — so the whole output budget goes to the XML.
   * - It answers in raw XML, not XML escaped inside a JSON string. Every quote
   *   in a DevExpress document is an attribute delimiter, and escaping them is
   *   pure overhead on the artifact that ran out of room.
   * - It transcribes rather than designs. The layout it is handed already
   *   carries every position, size, font, colour, border and table cell, so
   *   there is no measuring left to do.
   *
   * Deliberately no images: the layout is the specification now, and re-sending
   * the page would put the expensive part of the first request back into the one
   * meant to be cheap. One attempt only, and any failure leaves the original
   * untouched — a dead REPX with a working mockup is worse than what we had, but
   * an exception thrown here would lose the report entirely.
   */
  const rewriteRepxFromLayout = async (result: AnalysisResponse): Promise<string | null> => {
    if (signal?.aborted) return null;

    const startedAt = Date.now();
    try {
      const stream = await ai.models.generateContentStream({
        model: selectedModel,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are writing ONE artifact: a complete DevExpress XtraReports .repx document.

          A previous attempt produced this report's specification correctly but stopped part-way through the XML. The layout below is complete and correct — transcribe it, do not redesign it, and do not re-measure anything.

          Output the XML and NOTHING else: no explanation, no markdown fences, no JSON. Start with <?xml and end with </XtraReportsLayoutSerializer>.
${rootStructurePrompt({ page, reportUnit, targetVersion, targetSerializerVersion }, useBandedLayout)}
          - Each layout element becomes one control: "label" -> XRLabel, "table" -> XRTable with XRTableRow/XRTableCell (cells take Weight, never LocationFloat or SizeF), "image" -> XRPictureBox, "line" -> XRLine, "barcode" -> XRBarCode.
          - x, y, width and height are already in ${reportUnit} and become LocationFloat="x,y" and SizeF="width,height", with no space after the comma.
          - FONT SIZE IS IN POINTS, and the layout's fontSize is in report units: points = fontSize * 72 / ${unitsPerInchForReport}. Writing the layout number straight into Font makes every piece of text far too large.
          - Carry every appearance property across: bold/italic into Font, color into ForeColor, backgroundColor into BackColor (omit it when the area is white), textAlign + verticalAlign into TextAlignment, the border flags into Borders, wrap into WordWrap.
          - Include EVERY element of EVERY section. Completeness is the only thing that failed last time.
          - The XML must be strictly valid: all attribute values double-quoted, all tags closed, &amp; &lt; &gt; &quot; escaped inside values.

          THE LAYOUT TO TRANSCRIBE:
          ${JSON.stringify(result.layout)}`,
              },
            ],
          },
        ],
        config: {
          abortSignal: signal,
          temperature: 0,
          maxOutputTokens: 65536,
          // Matched to the main request rather than forced to 0. Disabling
          // thinking is the obvious lever here — this is transcription, and the
          // budget it frees is exactly what ran out — but some models refuse a
          // zero budget, and an error would cost the repair entirely.
          ...(typeof config?.thinkingBudget === "number"
            ? { thinkingConfig: { thinkingBudget: config.thinkingBudget } }
            : {}),
        },
      });

      let text = "";
      for await (const chunk of stream) {
        if (signal?.aborted) throw abortError();
        if (chunk.text) text += chunk.text;
        // The bar is already near the end of its travel; nudge it past where
        // the stream left it (95) and let the character count show that
        // something is still happening. The count is cumulative on purpose —
        // `applyStreamProgress` shows `streamChars` raw, so restarting it at
        // zero would run a real number backwards in front of the user.
        onProgress?.({
          chars: (rawText?.length ?? 0) + text.length,
          percent: 97,
          elapsedMs: Date.now() - startedAt,
        });
      }

      const document = extractRepxDocument(text);
      const check = checkRepxComplete(document);
      if (!check.complete) {
        console.warn(`REPX rewrite came back unfinished too (${check.reason}) — keeping the original.`);
        return null;
      }

      console.log(`REPX rewritten from the layout: ${check.length} characters in ${Date.now() - startedAt}ms.`);
      return document;
    } catch (error: any) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      console.warn("REPX rewrite failed; keeping the original.", error);
      return null;
    }
  };

  try {
    const parsed = parseAnalysisResponse(rawText, response.finishReason);
    console.log(`Successfully parsed Gemini response.`);

    /**
     * The model can finish the response and not the report. Nothing else in the
     * pipeline notices: `parseAnalysisResponse` sees valid JSON, the mockup
     * draws from the layout, and `checkRepx` only runs when the user tries to
     * leave with the file. Catch it here, where there is still a request's worth
     * of context and something can be done about it.
     */
    const completeness = checkRepxComplete(parsed.repxContent);
    if (!completeness.complete) {
      console.warn(
        `The generated REPX is unfinished — ${completeness.reason}. ` +
        `The response itself was complete (finishReason: ${response.finishReason ?? "none reported"}), ` +
        `so the layout survived; rewriting the XML from it.`
      );
      const rewritten = await rewriteRepxFromLayout(parsed);
      if (rewritten) parsed.repxContent = rewritten;
    }

    // First, because everything below assumes the document DevExpress will
    // load is the document we are looking at. A repeated Ref makes the loader
    // alias two elements onto one object and silently discard the second, so
    // a collision here costs whole controls with no error anywhere. Nothing
    // asks the model for unique numbering and the cheat sheet's snippets each
    // restart at Ref="1", so this is arithmetic rather than an instruction.
    // See `repxRefs.ts` for the measurement.
    const refs = ensureUniqueRefs(parsed.repxContent);
    if (refs.applied) {
      parsed.repxContent = refs.xml;
      console.warn(`REPX Ref collision repaired: ${refs.reason}.`);
    } else {
      console.debug(`REPX Refs: ${refs.reason}.`);
    }

    // The prompt pins Margins to zero so the model can write paper-absolute
    // coordinates, and the model then draws the design's margin as whitespace
    // instead. This puts it back into the structure. It is a translation, so
    // the page is unchanged; when it cannot prove that it declines and says
    // why. See `repxMargins.ts` for the reason it is arithmetic here rather
    // than an instruction up there.
    const lift = liftReportMargins(parsed.repxContent);
    if (lift.applied) {
      parsed.repxContent = lift.xml;
      console.log(`Margins: ${lift.reason}.`);
    } else {
      console.log(`Margins left as generated: ${lift.reason}.`);
    }

    // Opt-in, and last, because it is the only pass here that changes what the
    // report *says* rather than how it is structured: a bound cell shows the
    // field name where the source document showed a number. It runs after the
    // margin lift because that one rewrites coordinates and explicitly skips
    // nested controls, so giving it fewer children to walk costs nothing.
    if (bindingEnabled(viteEnv)) {
      const bound = bindDetailRow(parsed.repxContent);
      if (bound.applied) {
        parsed.repxContent = bound.xml;
        console.log(`Bindings: ${bound.reason}.`);
      } else {
        console.log(`Bindings left as generated: ${bound.reason}.`);
      }

      // Totals after the detail row, and only if that succeeded -- a footer
      // summing a column the detail row never bound would reference a field
      // nothing supplies. It declines far more often than it applies; see
      // `bindFooterTotals` for why that is the intended behaviour.
      if (bound.applied) {
        const totals = bindFooterTotals(parsed.repxContent);
        if (totals.applied) {
          parsed.repxContent = totals.xml;
          console.log(`Totals: ${totals.reason}.`);
        } else {
          console.log(`Totals left as generated: ${totals.reason}.`);
        }
      }
    }

    return parsed;
  } catch (e) {
    if (rawText) {
      console.error("Failed to parse Gemini response", e);
      console.error(
        `Raw response was ${rawText.length} characters, finishReason: ${response.finishReason ?? "none reported"}. ` +
        `Last 120 characters received: ${JSON.stringify(rawText.slice(-120))}`
      );
    }
    throw e;
  }
}