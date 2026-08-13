import { GoogleGenAI, Type } from "@google/genai";

/** One cell of a real `table` element. Weights are relative, like XRTableCell's. */
export interface ReportCell {
  content: string;
  /** Relative width within the row. Cells default to equal shares when omitted. */
  weight?: number;
  bold?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  backgroundColor?: string;
}

export interface ReportRow {
  cells: ReportCell[];
  /** Relative height within the table. Rows default to equal shares when omitted. */
  weight?: number;
  /** Header rows are drawn with the table's header emphasis. */
  isHeader?: boolean;
}

/**
 * A rectangle inside one of the uploaded source images, expressed as fractions
 * of that image's width/height (0..1). It lets the mockup crop the real artwork
 * out of the user's upload instead of drawing a grey placeholder — see
 * cropSourceRegion() in App.tsx. Fractions rather than pixels because the model
 * does not know the file's true pixel dimensions.
 */
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReportElement {
  id: string;
  type: 'label' | 'table' | 'chart' | 'gauge' | 'image' | 'line' | 'barcode';
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  /** Legacy "all four sides" flag. Still honoured; prefer the per-side flags below. */
  hasBorder?: boolean;

  /* --- Type fidelity, added so the mockup can resemble the source design. --- *
   * Every field is optional and the renderer falls back to the old behaviour
   * when absent, so layouts saved by earlier builds still render. */

  bold?: boolean;
  italic?: boolean;
  /** Font family name as seen in the design, e.g. "Arial". Rendered best-effort. */
  fontFamily?: string;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** True when the text flows onto multiple lines instead of being clipped. */
  wrap?: boolean;

  /** Per-side borders. Reports commonly rule only the bottom of a heading. */
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  borderColor?: string;

  /** Real grid content for `type: "table"`. Without it the table renders empty. */
  rows?: ReportRow[];

  /** Shape hint for `type: "chart"`, and the bar/point heights to draw. */
  chartType?: 'bar' | 'line' | 'pie' | 'area';
  chartValues?: number[];

  /**
   * Where this element's artwork sits in the upload, as Gemini's own detection
   * format: `[ymin, xmin, ymax, xmax]`, each normalised to 0-1000.
   *
   * This is deliberately not the more obvious {x, y, width, height} shape.
   * Asked for fractions the model reliably answered "the whole page"
   * ({0,0,1,1}) for every picture in a multi-image design; asked in the format
   * it was actually trained to emit for object detection, it localises. Order
   * really is y-first — swapping it silently transposes every crop.
   */
  box2d?: number[];

  /** Legacy fractional rectangle. Still honoured for reports saved earlier. */
  sourceRect?: SourceRect;
  /** Which uploaded file the box refers to. Defaults to the first. */
  sourceImageIndex?: number;
}


export interface ReportSection {
  id: string;
  name: string;
  type: 'header' | 'detail' | 'footer' | 'group';
  height: number;
  elements: ReportElement[];
}

export interface ReportLayout {
  title: string;
  pageWidth: number;
  sections: ReportSection[];
}

export interface AnalysisResponse {
  markdown: string;
  layout: ReportLayout;
  repxContent: string;
}

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
let resolvedModel: string | null = null;

/** Exported so the debug console can report the detected model without re-probing. */
export function readCachedModel(): string | null {
  if (resolvedModel) return resolvedModel;
  try {
    return sessionStorage.getItem(MODEL_CACHE_KEY);
  } catch {
    return null; // Node, or storage disabled
  }
}

function cacheModel(model: string): void {
  resolvedModel = model;
  try {
    sessionStorage.setItem(MODEL_CACHE_KEY, model);
  } catch {
    /* in-memory copy still applies for this page */
  }
}

/** Drop the cached choice — called when a model 404s mid-flight, or the key changes. */
export function clearCachedModel(): void {
  resolvedModel = null;
  try {
    sessionStorage.removeItem(MODEL_CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}

type Probe = "ok" | "unavailable" | "quota" | "keyError";

async function probeModel(model: string, apiKey: string, signal?: AbortSignal): Promise<Probe> {
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
        signal,
      }
    );
    if (res.ok) return "ok";
    if (res.status === 404) return "unavailable";
    if (res.status === 429) return "quota";
    if (res.status === 403 || res.status === 400) return "keyError";
    return "unavailable";
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return "unavailable";
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
  const verdicts = await Promise.all(
    MODEL_PREFERENCE.map((candidate) => probeModel(candidate, apiKey, signal))
  );
  console.debug(`Model probing finished in ${Date.now() - started}ms.`);

  const winner = MODEL_PREFERENCE.find((_, i) => verdicts[i] === "ok");
  if (winner) {
    console.log(`Auto-selected Gemini model: ${winner}`);
    cacheModel(winner);
    return winner;
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
export type AttachmentPart =
  | { inlineData: { data: string; mimeType: string } }
  | { text: string };

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
   * (23.2.3.0) and the target ERP's template (20.1.3.0). If a build number ever
   * has to be exact, it belongs in a map keyed by version rather than here.
   */
  const targetVersion = config?.version || '23.2';
  const targetSerializerVersion = `${targetVersion}.3.0`;

  const configInstructions = config ? `
  CRITICAL CONFIGURATION:
  - DevExpress Version: ${config.version}
  - ReportUnit: ${config.unit}
  - Page Size: ${config.pageSize} (Adjust PaperKind and page dimensions accordingly)
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
          - Use their x/y/w/h numbers as the basis for LocationFloat and SizeF. They are already in report units (hundredths of an inch) with the origin at the top-left, so they need no conversion.
          - Use the page image for what the text layer cannot express: borders, rules, fills, logos, images, alignment and overall visual structure.
          - If the image and the extracted text disagree about a string or a position, the extracted text wins.
          - When an existing .repx is supplied, treat it as the base structure and preserve it, applying only the changes the user asks for.

          PHASE 1: SPATIAL MAPPING
          Before generating the output, list elements and their exact coordinates and sizes in hundredths of an inch (X, Y, Width, Height) in the markdown section.
          - 1 inch = 100 units. A standard 8.5" x 11" page is 850 x 1100.
          - Map the visual proportions perfectly to this grid.

          PHASE 2: DEVEXPRESS CHEAT SHEET (STRICT SYNTAX)
          When generating the "repxContent" XML, you MUST use these exact structures:
          
          - ROOT STRUCTURE: The entire repxContent MUST be wrapped exactly like this:
            <?xml version="1.0" encoding="utf-8"?>
            <XtraReportsLayoutSerializer SerializerVersion="${targetSerializerVersion}" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="100, 100, 100, 100" PageWidth="850" PageHeight="1100" Version="${targetVersion}">
              <Bands>
                <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
                <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="100">
                  <Controls>
                    <!-- Your controls go here -->
                  </Controls>
                </Item2>
                <Item3 Ref="3" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" />
              </Bands>
            </XtraReportsLayoutSerializer>
            
          - Labels: <Item1 Ref="1" ControlType="XRLabel" Name="label1" Text="My Text" LocationFloat="0,10" SizeF="200,30" Padding="2,2,0,0,100" />
          - Tables: <Item2 Ref="2" ControlType="XRTable" Name="table1" LocationFloat="0,50" SizeF="400,20" Borders="All"><Rows><Item1 Ref="3" ControlType="XRTableRow" Name="row1" Weight="1"><Cells><Item1 Ref="4" ControlType="XRTableCell" Name="cell1" Text="Data" Weight="1" /></Cells></Item1></Rows></Item2>
          - Images: <Item3 Ref="5" ControlType="XRPictureBox" Name="pictureBox1" Sizing="ZoomImage" LocationFloat="0,100" SizeF="150,150" />
          - Lines: <Item4 Ref="6" ControlType="XRLine" Name="line1" LocationFloat="0,260" SizeF="300,5" />
          - Page Info: <Item5 Ref="7" ControlType="XRPageInfo" Name="pageInfo1" PageInfo="DateTime" LocationFloat="0,270" SizeF="150,20" />
          - Barcode: <Item6 Ref="8" ControlType="XRBarCode" Name="barcode1" LocationFloat="0,300" SizeF="200,50"><Symbology Name="Code128" /></Item6>
          Always use standard DevExpress.XtraReports.UI components. Ensure LocationFloat and SizeF use comma without spaces for numbers (e.g. "150.5,20.3").

          ${configInstructions}
          ${previousContext}
          
          Return a JSON object with three fields:
          1. "markdown": A detailed written report specification (description, components, styles).
          2. "layout": A structured representation of the visual layout for a UI preview mockup.
          3. "repxContent": A complete, valid DevExpress REPX XML string representing the full report layout. Use standard DevExpress.XtraReports.UI components (Bands, XRLabel, XRTable, XRPictureBox, etc.).
          
          CRITICAL XML VALIDITY RULES FOR repxContent:
          - The repxContent MUST be strictly valid XML.
          - ALL XML attribute values MUST be enclosed in double quotes (e.g., Text="My Label").
          - NEVER leave a string unclosed. Check every single quote.
          - If you need to use quotes, angle brackets, or ampersands inside an attribute value, use proper XML entities (e.g., &quot;, &apos;, &lt;, &gt;, &amp;).
          - Ensure all XML tags are properly closed.
          - Do NOT include markdown formatting (like \`\`\`xml) inside the repxContent string itself, just the raw XML.
          - DEVEXPRESS EXPRESSIONS & STRINGS: If you use DevExpress Expressions (<ExpressionBindings><Item1 Expression="..."/></ExpressionBindings>), any string literals inside the expression MUST be enclosed in single quotes.
          - CRITICAL XML ESCAPING: If a string literal inside an expression contains a single quote (like "Don't"), you MUST escape it by doubling the single quote (e.g., Expression="'Don''t do this'"). BUT YOU MUST ALSO escape the outer XML double quotes and special characters like &lt; and &gt;.
          - If the user provides a barcode, use ControlType="XRBarCode". For Lines, use ControlType="XRLine".
          - EXACT COMPLETENESS: Do not skip ANY table cells, labels, or elements to save tokens. The output must be 100% complete and exhaustive.
          
          The "layout" JSON must follow this structure (use standard DevExpress units, e.g., hundredths of an inch, so x, y, width, height match your REPX coordinates relative to the section's top-left corner):
          {
            "title": "Report Title",
            "pageWidth": 850,
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
          - "fontSize": in the same units as the rest of the layout. Match relative sizes carefully — a title must be visibly larger than body text.
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
          - DEVEXPRESS TABLES: For any grid/table UI (like Department/Rows), you MUST generate a proper DevExpress \`<XRTable>\`, \`<XRTableRow>\`, and \`<XRTableCell>\` in the XML. Ensure their locations (LocationFloat) and sizes (SizeF) match the requested design perfectly. Use \`Borders="All"\` where needed.
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
        const backoffMs = 2000 * overloadAttempts; // 2s, then 4s
        console.warn(
          `Model "${selectedModel}" is overloaded (503). Retrying in ${backoffMs}ms — attempt ${overloadAttempts} of ${MAX_OVERLOAD_RETRIES}.`
        );
        await sleep(backoffMs, signal);
        continue;
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

    const message: string = error?.message || "";
    const status = error?.status;

    if (status === 429 || message.includes("429") || status === "RESOURCE_EXHAUSTED" || message.includes("RESOURCE_EXHAUSTED")) {
      return new Error("You have exceeded your Gemini API quota. Please check your plan and billing details, or try again later.");
    }

    // A revoked or leaked key comes back as 403 PERMISSION_DENIED. Previously this
    // fell through to the generic branch below, so "your key is dead" was
    // indistinguishable from any other model error.
    if (status === 403 || message.includes("403") || message.includes("PERMISSION_DENIED")) {
      if (message.toLowerCase().includes("leaked")) {
        return new Error(
          "Google has disabled this API key because it was published somewhere public. Create a new key in Google AI Studio and paste it in Settings."
        );
      }
      return new Error(
        "Your Gemini API key was rejected. Check that it is correct and that the Generative Language API is enabled for its project."
      );
    }

    if (status === 400 || message.includes("API_KEY_INVALID") || message.includes("API key not valid")) {
      return new Error("That Gemini API key is not valid. Check for a typo or paste it again in Settings.");
    }

    // Reached only when re-detection has already been tried and still failed.
    if (status === 404 || message.includes("NOT_FOUND")) {
      return new Error(
        "No Gemini model available to this API key could complete the request. Your key may be too new, or every model may be over quota."
      );
    }

    // Reached only after the automatic retries above have already been spent.
    if (isOverloaded(error)) {
      return new Error(
        "Google's servers are busy and could not take this request, even after retrying. Nothing is wrong with your API key or your design — wait a minute and generate again."
      );
    }

    // SDK errors frequently carry the provider's raw JSON as their message.
    // Showing that verbatim puts a wall of braces in front of the user, so pull
    // out the human-readable part when there is one.
    let readable = message;
    try {
      const jsonStart = message.indexOf("{");
      if (jsonStart !== -1) {
        const parsed = JSON.parse(message.slice(jsonStart));
        readable = parsed?.error?.message || readable;
      }
    } catch {
      /* not JSON after all — fall back to the message as given */
    }

    return new Error(`AI model error: ${readable || "Unknown error"}`);
  }

  const tResponded = Date.now();
  console.log(
    `Generation timing — model detection ${tResolved - tStart}ms, ` +
    `request ${tResponded - tResolved}ms, total ${tResponded - tStart}ms ` +
    `(model: ${selectedModel}${overloadAttempts ? `, ${overloadAttempts} overload retry/retries` : ""}).`
  );

  console.debug(`Received raw response from Gemini. Parsing JSON...`);
  
  // An empty body used to be parsed as "{}" and returned as a success, so a
  // blocked or truncated generation surfaced much later as a render crash on a
  // missing `layout.sections`. Fail here, where the cause is still visible.
  const rawText = response.text?.trim();
  if (!rawText) {
    const finishReason = response.finishReason;
    console.error("Gemini returned an empty response. finishReason:", finishReason);

    if (finishReason === "MAX_TOKENS") {
      throw new Error(
        "The report was too large to finish generating. Try a simpler design, or split it across two requests."
      );
    }
    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
      throw new Error("Gemini blocked this request under its safety filters. Try a different source image or prompt.");
    }
    throw new Error("Gemini returned an empty response. Try generating again.");
  }

  try {
    const parsed = JSON.parse(rawText) as AnalysisResponse;
    if (!parsed?.layout?.sections) {
      // Schema-valid JSON that is missing the part the mockup renders.
      throw new Error("missing layout");
    }
    console.log(`Successfully parsed Gemini response.`);
    return parsed;
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    console.debug("Raw response length:", rawText.length);
    throw new Error("The AI returned a malformed report. Try generating again.");
  }
}
