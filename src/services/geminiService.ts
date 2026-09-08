import { loadGenAI } from "../lib/genai";
import { usableFromCatalog, mergeCandidates } from "../lib/modelCatalog";
import { classifyGeminiError } from "../lib/geminiErrors";
import { parseAnalysisResponse } from "../lib/analysisResponse";
import { cacheModel, readCachedModel, readCachedModelSet, clearCachedModel } from "../lib/modelCache";
import { liftReportMargins } from "../lib/repxMargins";
import { ensureUniqueRefs } from "../lib/repxRefs";
import { normalizeItemNames } from "../lib/repxItems";
import { instructionBlock } from "../lib/userInstructions";
import { auditRepx } from "../lib/repxAudit";
import { liftParameterTypes } from "../lib/repxParameters";
import { liftStyles } from "../lib/repxStyles";
import { rootStructurePrompt, tableRowsRule } from "../lib/reportBands";
import { readTokenUsage, type TokenUsage } from "../lib/tokenUsage";
import { sectionsFor, describeSections, ALL_SECTIONS } from "../lib/promptSections";
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

/**
 * The canned response `VITE_FORMA_MOCK` returns.
 *
 * It is worth keeping this *correct* rather than merely plausible. The mock path
 * returns before the repair passes and before this file's own `auditRepx` call,
 * so what is written here is exactly what the UI audits — a fixture that breaks
 * a rule shows the user a warning about the fixture, and the next person has to
 * work out whether the app or the fake data is at fault. It happened: two
 * sections against one content band lit "1 REPX warning" in the status bar on
 * every mock run.
 *
 * So the two artifacts obey what `reportBands.ts` asks the real model for. One
 * content band per layout section, in the same order, with the same height and
 * the same band-relative coordinates; `Margins="0, 0, 0, 0"` with both margin
 * bands at `HeightF="0"`; and font sizes converted to points, since a layout
 * `fontSize` is in report units and `Font=` is not — 16 units at
 * HundredthsOfAnInch is 11.52pt, not 16pt.
 */
/**
 * The one `VITE_FORMA_MOCK` value that returns a deliberately broken fixture.
 *
 * Anything else truthy gives the correct one, which is the point: the paragraph
 * above records that a mock breaking an audit rule cost someone real time
 * working out whether the app or the fake data was at fault. That stays true by
 * default and is opt-in by a value nobody types by accident.
 */
export const MOCK_MISORDERED = "misordered";

/** Is mock mode on at all? Both the generation and the chat path ask this. */
export function isMockMode(value: string | undefined): boolean {
  return value === "true" || value === MOCK_MISORDERED;
}

/**
 * Swap the ReportHeader and PageHeader bands in the mock REPX, to exercise
 * `repxAudit`'s `band-order` warning against a running app.
 *
 * Added 2026-09-06. The rule had six unit tests and no way to be seen firing in
 * the UI, because the mock -- the only offline generation path -- is correct by
 * design and a real generation needs a key.
 *
 * **It swaps the `ItemN` prefixes as well as the blocks, and that is the whole
 * subtlety.** `ItemN` is a position inside its own collection, so moving the
 * blocks without renumbering also trips `item-numbering`, and the fixture would
 * then light two findings where the point is to demonstrate one. See
 * `repxItems.ts` for why that numbering is load-bearing rather than cosmetic.
 *
 * Deliberately a transform rather than a second fixture: `viteEnv` reads
 * `import.meta.env` through a variable, so Vite cannot prove the mock branch
 * dead and none of it is tree-shaken -- a duplicate fixture would put another
 * ~2.4 kB into the shipped `geminiService-` chunk, which has ~6.7 kB of budget
 * left. This is about 400 bytes.
 *
 * Written against this fixture, not as a general REPX transform. The tests
 * assert the result rather than trusting the regexes, so if the fixture changes
 * shape they fail here instead of producing a silently unswapped report.
 */
export function misorderMockHeaders(xml: string): string {
  const report = /[ \t]*<Item2 (?=[^>]*ControlType="ReportHeaderBand")[\s\S]*?<\/Item2>\r?\n/;
  const page = /[ \t]*<Item3 (?=[^>]*ControlType="PageHeaderBand")[\s\S]*?<\/Item3>\r?\n/;

  const reportBlock = report.exec(xml)?.[0];
  const pageBlock = page.exec(xml)?.[0];
  if (!reportBlock || !pageBlock) return xml;

  // Renumber as they move: the PageHeader becomes the second band and the
  // ReportHeader the third, so the collection stays correctly numbered and the
  // only thing wrong with the file is the order.
  const renumbered = (block: string, to: string) =>
    block.replace(/<Item\d+ /, `<Item${to} `).replace(/<\/Item\d+>(\r?\n)$/, `</Item${to}>$1`);

  // Function replacers throughout: a string replacement would let $& and its
  // friends inside the inserted markup be interpreted rather than inserted.
  // REPX carries no dollar sign today, which is the kind of thing that stops
  // being true quietly.
  const SLOT = "REPORT_HEADER_SLOT";
  return xml
    .replace(reportBlock, () => SLOT)
    .replace(pageBlock, () => renumbered(reportBlock, "3"))
    .replace(SLOT, () => renumbered(pageBlock, "2"));
}

export const MOCK_INVOICE_RESPONSE: AnalysisResponse = {
  markdown: `# Mock Invoice Report\n\nThis is a canned layout returned by \`VITE_FORMA_MOCK\`, not generated output.\n\n## Bands\n- **Report Header**: the invoice title, printed once.\n- **Page Header**: the column headings, repeated on every sheet.\n- **Detail**: one line item, printed once per record.`,
  repxContent: `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100" Version="23.2">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="100">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="labelTitle" Text="INVOICE - FORMA MOCK ENGINE" LocationFloat="20,20" SizeF="500,40" Font="Arial, 11.52pt" Padding="2,2,0,0,100" />
        <Item2 Ref="15" ControlType="XRCheckBox" Name="checkPaid" Checked="true" CheckBoxState="Checked" Text="Paid in full" LocationFloat="20,65" SizeF="200,20" Font="Arial, 7.2pt" />
      </Controls>
    </Item2>
    <Item3 Ref="4" ControlType="PageHeaderBand" Name="PageHeader" HeightF="30">
      <Controls>
        <Item1 Ref="5" ControlType="XRTable" Name="tableHead" LocationFloat="20,5" SizeF="810,20">
          <Rows>
            <Item1 Ref="6" ControlType="XRTableRow" Name="rowHead" Weight="1">
              <Cells>
                <Item1 Ref="7" ControlType="XRTableCell" Name="headDescription" Text="Item Description" Weight="3" Font="Arial, 7.2pt, style=Bold" />
                <Item2 Ref="8" ControlType="XRTableCell" Name="headAmount" Text="Amount" Weight="1" Font="Arial, 7.2pt, style=Bold" TextAlignment="MiddleRight" />
              </Cells>
            </Item1>
          </Rows>
        </Item1>
      </Controls>
    </Item3>
    <Item4 Ref="9" ControlType="DetailBand" Name="Detail" HeightF="40">
      <Controls>
        <Item1 Ref="10" ControlType="XRTable" Name="tableDetail" LocationFloat="20,5" SizeF="810,25">
          <Rows>
            <Item1 Ref="11" ControlType="XRTableRow" Name="rowDetail" Weight="1">
              <Cells>
                <Item1 Ref="12" ControlType="XRTableCell" Name="cellDescription" Text="Mock Layout Development Service" Weight="3" Font="Arial, 7.2pt" />
                <Item2 Ref="13" ControlType="XRTableCell" Name="cellAmount" Text="1,250.00" Weight="1" Font="Arial, 7.2pt" TextAlignment="MiddleRight" />
              </Cells>
            </Item1>
          </Rows>
        </Item1>
      </Controls>
    </Item4>
    <Item5 Ref="14" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`,
  layout: {
    title: "Mock Invoice Report",
    pageWidth: 850,
    sections: [
      {
        id: "report-header",
        name: "ReportHeader",
        type: "header",
        height: 100,
        elements: [
          { id: "lbl-title", type: "label", content: "INVOICE - FORMA MOCK ENGINE", x: 20, y: 20, width: 500, height: 40, fontSize: 16 },
          { id: "chk-paid", type: "checkbox", content: "Paid in full", checked: true, x: 20, y: 65, width: 200, height: 20, fontSize: 10 }
        ]
      },
      {
        id: "page-header",
        name: "PageHeader",
        type: "header",
        height: 30,
        elements: [
          {
            id: "tbl-head", type: "table", content: "", x: 20, y: 5, width: 810, height: 20, fontSize: 10,
            rows: [{ cells: [{ content: "Item Description", bold: true }, { content: "Amount", bold: true, textAlign: "right" }] }]
          }
        ]
      },
      {
        id: "detail",
        name: "Detail",
        type: "detail",
        /* Tall enough for the four rows below.
         *
         * This deliberately does NOT match the DetailBand's HeightF of 40, and
         * the mismatch is the point: the layout describes the SOURCE document,
         * where the detail area shows four rows at once, while the band
         * describes the REPORT, where one row repeats per record. */
        height: 110,
        elements: [
          {
            /* Every row the model could read, which is the one deliberate
               difference from the Detail BAND above — and what the preview
               counts records from.

               **The height has to carry all of them.** MockupTable divides its
               declared height between its rows, so four rows in the height of
               one gave each row a quarter of a line and `overflow: hidden` cut
               the text into an illegible band -- which reads as rows drawn on
               top of each other, and was reported that way. Nothing warns: the
               REPX was correct throughout, and only the Mockup looked wrong. */
            id: "tbl-detail", type: "table", content: "", x: 20, y: 5, width: 810, height: 100, fontSize: 10,
            rows: [
              { cells: [{ content: "Item Description" }, { content: "Amount", textAlign: "right" }] },
              { cells: [{ content: "Mock Layout Development Service" }, { content: "1,250.00", textAlign: "right" }] },
              { cells: [{ content: "Second Mock Line Item" }, { content: "480.00", textAlign: "right" }] },
              { cells: [{ content: "Third Mock Line Item" }, { content: "95.50", textAlign: "right" }] }
            ]
          }
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

/*
 * The session model cache moved to `lib/modelCache.ts` on 2026-09-04, when this
 * service was deferred behind `lib/geminiClient.ts`. `App.tsx` clears it from a
 * synchronous `useEffect`, so it is the one part of this file the eager bundle
 * still needs; leaving it here would have pulled the mega-prompt back in.
 *
 * `readCachedModel` and `clearCachedModel` are re-exported below because
 * `modelResolution.test.ts` imports them from this module and there is no
 * reason to churn a passing test to record a bundling decision.
 */
export { readCachedModel, clearCachedModel } from "../lib/modelCache";

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
/**
 * 503 / UNAVAILABLE means Google's capacity for this model is momentarily
 * exhausted. The request never really started, nothing is wrong with the key or
 * the design, and the identical request usually succeeds moments later — so
 * retry it rather than making the user do the turn again.
 *
 * Module scope since 2026-09-05, because it was defined inside
 * `analyzeReportDesign` and so only generation was protected by it. Chat failed
 * on the first 503 with "This model is currently experiencing high demand",
 * while a generation issued a second later would retry twice and then fall back
 * to another model. Same key, same outage, two different behaviours.
 */
export function isOverloaded(error: any): boolean {
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
}

/**
 * A stream that stopped mid-object rather than a request that was refused.
 *
 * `Incomplete JSON segment at the end` comes from the SDK's SSE reader, not
 * from this file: the connection ended between two chunks and the parser was
 * left holding half a JSON object. Nothing about the request was wrong, so the
 * same request is worth making again — the same argument as a 503, arriving
 * one layer lower. Observed twice in a row while chatting on 2026-09-05.
 */
export function isTruncatedStream(error: any): boolean {
  const text = `${error?.message || ""}`.toLowerCase();
  return (
    text.includes("incomplete json") ||
    text.includes("unexpected end") ||
    text.includes("network error") ||
    text.includes("failed to fetch")
  );
}

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
  if (isMockMode(viteEnv.VITE_FORMA_MOCK)) {
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
  /*
   * Reassignable, because a model that stays overloaded is swapped out below.
   * `pinnedModel` is the user having chosen one in config: answering on a
   * different model than the one they named would make that setting a lie, so
   * the fallback is skipped entirely in that case.
   */
  const pinnedModel = Boolean(config?.modelName?.trim());
  let activeModel = config?.modelName?.trim() || (await resolveModel(currentApiKey, signal));
  const overloadedModels: string[] = [];

  const transcript = history
    .slice(-10) // recent context is enough, and keeps the call small
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
    .join('\n');

  const startedAt = Date.now();

  const buildChatRequest = (disableThinking: boolean) => ({
    model: activeModel,
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

  let raw = '';
  let lastEmitted = '';
  let firstChunkAt = 0;

  /**
   * The whole turn is retryable, request and stream together.
   *
   * Until 2026-09-05 neither half was. A 503 on the request surfaced as "This
   * model is currently experiencing high demand" and the turn was lost, while
   * `analyzeReportDesign` would have retried the same failure twice and then
   * changed model. A stream that ended mid-object surfaced as the SDK's
   * "Incomplete JSON segment at the end" and was likewise fatal.
   *
   * Retrying from the top rather than resuming the stream, because a partial
   * reply is worth nothing: the response is one JSON object and half of it does
   * not parse. `raw` is reset each attempt for the same reason, and the partial
   * text already typed into the UI is cleared so the next attempt does not
   * appear to continue the abandoned one.
   */
  const MAX_CHAT_RETRIES = 2;

  for (let attempt = 0; ; attempt++) {
    raw = '';
    lastEmitted = '';
    firstChunkAt = 0;

    try {
      let stream;
      // Re-read each attempt: a previous attempt may have just learned that
      // this model rejects thinkingBudget:0.
      const attemptWithoutThinking = !thinkingUnsupportedForModel.has(activeModel);

      try {
        stream = await ai.models.generateContentStream(buildChatRequest(attemptWithoutThinking));
      } catch (err: any) {
        const message = `${err?.message || ""}`;
        const invalidArgument =
          err?.status === 400 ||
          message.includes("INVALID_ARGUMENT") ||
          message.includes("invalid argument");

        /*
         * A rejected key also arrives as a 400, and without this it was read as
         * "this model rejects thinkingBudget:0": a second request that fails
         * identically, a warning naming the wrong cause, and the model marked
         * thinking-unsupported for the rest of the session on the strength of
         * an auth failure. Narrowed rather than replaced, because some models
         * really do return a bare 400 with no useful message for the thinking
         * parameter, which is what the fallback was written for.
         */
        const authFailure = /api[ _-]?key|unauthenticated|permission|unauthori[sz]ed/i.test(message);

        if (attemptWithoutThinking && invalidArgument && !authFailure && !signal?.aborted) {
          // Remember for the rest of the session so this costs one failed request
          // per model, not one per message.
          thinkingUnsupportedForModel.add(activeModel);
          console.warn(
            `Model "${activeModel}" rejected thinkingBudget:0 — retrying without it. ` +
            `Chat replies will be slower on this model.`
          );
          stream = await ai.models.generateContentStream(buildChatRequest(false));
        } else {
          throw err;
        }
      }

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

      break; // The turn completed.
    } catch (err: any) {
      // Cancellation is the user's decision and is never retried.
      if (signal?.aborted || err?.name === 'AbortError') throw err;

      const retryable = isOverloaded(err) || isTruncatedStream(err);
      if (retryable && attempt < MAX_CHAT_RETRIES) {
        // Jittered, for the reason the generation path gives: without it every
        // tab that got a 503 in the same second retries in the same second.
        const backoffMs = Math.round(1500 * 2 ** attempt * (1 + Math.random() * 0.4));
        console.warn(
          `Chat turn failed (${isOverloaded(err) ? 'overloaded' : 'stream ended early'}). ` +
          `Retrying in ${backoffMs}ms — attempt ${attempt + 1} of ${MAX_CHAT_RETRIES}.`
        );
        // Drop the abandoned partial so the retry does not look like a continuation.
        onPartialReply?.('');
        await sleep(backoffMs, signal);
        continue;
      }

      /*
       * The retries are spent. If the model is simply busy, try another one the
       * key was already shown to be able to call.
       *
       * `analyzeReportDesign` has always done this; the chat path was given the
       * retry loop on 2026-09-05 and not the fallback, so a 503 on the
       * auto-selected model ended the turn with every probed alternative
       * sitting unused in the session cache. Reported from a real session on
       * 2026-09-08 whose console said "6 more available as fallbacks" three
       * lines above the failure.
       *
       * Bounded by construction: each exhausted model is recorded, `find`
       * skips them, and the turn throws once nothing is left.
       */
      if (isOverloaded(err) && !pinnedModel) {
        overloadedModels.push(activeModel);
        // The probed set when there is one. A turn that resolved its model
        // before the set was cached falls back to the raw preference list,
        // exactly as the generation path does.
        const alternatives = readCachedModelSet() ?? MODEL_PREFERENCE;
        const next = alternatives.find((m) => !overloadedModels.includes(m));

        if (next) {
          console.warn(
            `Model "${activeModel}" stayed overloaded after ${MAX_CHAT_RETRIES} retries. ` +
            `Falling back to "${next}" for this reply.`
          );
          activeModel = next;
          onPartialReply?.('');
          // -1 because the loop's own increment runs before the next attempt:
          // the new model gets a full retry budget rather than inheriting the
          // exhausted one.
          attempt = -1;
          continue;
        }
      }

      throw asReadableError(err);
    }
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

/**
 * The control syntax a document only sometimes needs: checkboxes, cross-band
 * rules, panels, and the instruction NOT to invent a subreport.
 *
 * Lifted out of the cheat sheet so `lib/promptSections.ts` can leave it out of
 * a request that provably does not need it. Text unchanged from when it was
 * inline -- moved by script rather than retyped.
 */
/**
 * Conditional formatting, in its own section because it is asked for rather than
 * seen — see `lib/promptSections.ts`.
 *
 * Syntax measured with `RepxProbe emit-rules`. The two things a class reference
 * would not have told us: the sheet is written BEFORE `<Bands>` (the style sheet
 * is written after, so the two root collections sit on opposite sides), and a
 * control links a rule through a `#Ref-N` pointer rather than by name.
 */
/**
 * Calculated fields — a named expression that behaves like a data field.
 *
 * Measured with `RepxProbe emit-calc`. The finding that matters is a negative
 * one about a requirement: **no data source is needed.** `DataMember` is written
 * only when set, and a field with nothing but a name, a type and an expression
 * is complete — so this is usable in a tool that never opens a connection.
 */
/**
 * Gauges and sparklines.
 *
 * `gauge` has been a valid element type in the LAYOUT schema all along while
 * the prompt gave no REPX syntax for it, so the model could draw one in the
 * mockup that the exported file would never contain -- the exact divergence the
 * prompt forbids everywhere else. Measured with `RepxProbe emit-gauge`.
 */
const GAUGES_BLOCK = `          - GAUGES AND SPARKLINES — a dial or a trend line, when the source document shows one.
            <Item1 Ref="3" ControlType="XRGauge" Name="gaugeComplete" ActualValue="72" Minimum="0" Maximum="100" TargetValue="90" SizeF="200,200" LocationFloat="0,0" />
            <Item2 Ref="4" ControlType="XRGauge" Name="gaugeLinear" ViewType="Linear" ViewStyle="Horizontal" ActualValue="40" SizeF="300,60" LocationFloat="220,0" />
            <Item3 Ref="5" ControlType="XRSparkline" Name="sparkTrend" DataMember="Monthly" ValueMember="Amount" SizeF="200,40" LocationFloat="0,220"><View Type="Line" /><ValueRange Ref="6" /></Item3>
            - **A circular gauge writes NO ViewType.** Circular is the default, so a dial is just the four numbers; only ViewType="Linear" is written, and a linear gauge also takes ViewStyle="Horizontal" or "Vertical".
            - Minimum and Maximum are the scale, ActualValue the needle, TargetValue an optional marker. Give a gauge its scale: without Minimum and Maximum the needle has nothing to be a proportion of.
            - A gauge's value can be BOUND instead of literal — an <ExpressionBindings> item with PropertyName="ActualValue". Inside a Detail band that is almost always what is wanted, since a literal repeats per record.
            - A sparkline needs **no data source**: DataMember names the collection and ValueMember the field, both as plain attributes. <View Type="Line" /> is always written — Line, Bar, Area or WinLoss — and note it is the ONE child element in this format that carries no Ref.
            - **Only when the source shows one.** A dial drawn because a number looked like a percentage is an invention, and a sparkline needs a series the document does not have on a single-record page.
`;
/**
 * Bookmarks -- the document map, and the PDF outline it exports into.
 *
 * Measured with `RepxProbe emit-book`. `BookmarkParent` is a `#Ref-N` pointer,
 * the fifth in this format, and the one that tested the prediction written in
 * `repxRefs.ts` after the fourth.
 */
const BOOKMARKS_BLOCK = `          - BOOKMARKS — the navigation tree beside a long report, and the outline it exports into a PDF.
            A report with sections a reader jumps between should say what those sections are. It is two attributes on the control that heads each section:
            <Item1 Ref="3" ControlType="XRLabel" Name="labelSection" Text="Northern Region" Bookmark="Northern Region" SizeF="400,30" LocationFloat="0,0" />
            <Item2 Ref="4" ControlType="XRLabel" Name="labelCustomer" Text="Acme Ltd" Bookmark="Acme Ltd" BookmarkParent="#Ref-3" SizeF="400,20" LocationFloat="20,35" />
            - **BookmarkParent is a "#Ref-N" POINTER at another CONTROL's Ref** — not a name. #Ref-3 above means the control whose Ref="3". Omit it for a top-level entry.
            - A bookmark that repeats per record should be an EXPRESSION, not a literal: an <ExpressionBindings> item with PropertyName="Bookmark" and Expression="[Region]". A literal on a control inside the Detail band produces the same caption on every row, which is a document map with forty identical entries.
            - Put the bookmark on the control that already carries the section's caption. A second invisible label existing only to hold a bookmark is a control that can be moved out of alignment with the thing it names.
            - **Only when the report has sections.** A one-page invoice needs no document map, and a bookmark on its title adds a tree with one entry.
            - A TABLE OF CONTENTS lists those bookmarks on a page of its own:
              <Item1 Ref="3" ControlType="XRTableOfContents" Name="toc" LocationFloat="0,0"><LevelTitle Ref="4" Text="Contents" Font="Arial, 16pt, style=Bold" /><LevelDefault Ref="5" Font="Arial, 11pt" /></Item1>
              - **It may go ONLY in a ReportHeader or a ReportFooter band, and there may be only ONE in a report.** DevExpress throws on both, and on the second one the message names the wrong rule -- it complains about the band -- so a file with two is a confusing failure rather than a clear one.
              - **Write no SizeF.** The control sizes itself from the entries it finds; setting a size is discarded. LocationFloat is written, SizeF is not.
              - LevelTitle is the "Contents" heading. LevelDefault styles the rows. Both are child elements with their own Ref.
              - It lists the report's BOOKMARKS, so a table of contents in a report with no bookmarks prints its heading and nothing else. Emit the bookmarks first, or neither.
`;
/**
 * Multi-column detail flow — a label sheet, a phone list, a two-up catalogue.
 *
 * Measured with `RepxProbe emit-cols`. Three things: it is a child element of
 * the BAND written before `<Controls>`, a band left alone writes nothing at all
 * (so absence is one column), and the obsolete `Direction` property serializes
 * as `Layout`.
 */
const COLUMNS_BLOCK = `          - MULTI-COLUMN DETAIL — records flowing into columns rather than one per full-width row.
            A label sheet, a phone list, a two-up catalogue. It is a property of the DETAIL BAND, written as a child element BEFORE <Controls>:
            <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="40">
              <MultiColumn Ref="3" ColumnCount="3" ColumnSpacing="20" Layout="AcrossThenDown" Mode="UseColumnCount" />
              <Controls> ... </Controls>
            </Item2>
            - **Mode decides which of the two size properties is read.** Mode="UseColumnCount" reads ColumnCount and ignores ColumnWidth; Mode="UseColumnWidth" does the opposite. Write the mode that matches the property you set, or the one you set is silently ignored and the report prints in one column.
            - Layout is AcrossThenDown (fill left to right, then the next row) or DownThenAcross (fill the first column top to bottom, then the next). The attribute is **Layout**, not Direction. **DownThenAcross is the default and writing it is optional; AcrossThenDown must be written or the report fills column by column.** Read the source: a phone list runs down a column, a label sheet usually runs across.
            - **Size the controls to ONE COLUMN.** A control wider than its column is NOT clipped — measured — so it prints straight over the next column and the page looks like overlapping content rather than a width mistake.
            - ColumnSpacing is in the report's own units, like every other measurement except font size and border width.
            - The element carries a Ref and NO ControlType.
            - **Omit it entirely for an ordinary report.** A band with no <MultiColumn> prints one column, which is what almost every document wants. Only emit it when the source visibly repeats its records side by side across the page.
            - With ColumnCount="3" and ColumnSpacing="20" on an 850-wide page each column is (850 - 40) / 3 = 270 units, so a table filling a column is SizeF="270,…" and not "810,…".
`;

/**
 * A page watermark.
 *
 * Measured with `RepxProbe emit-mark`. The half that matters is the split: a
 * TEXT watermark is six attributes, an IMAGE one is `ImageSource=` carrying
 * base64 -- 172 characters for a 4x4 bitmap -- so only one half is authorable.
 */
const WATERMARK_BLOCK = `          - WATERMARK — DRAFT, COPY, CONFIDENTIAL across the page.
            A word printed large and pale behind the content, usually diagonal. It is a property of the REPORT, written as a single element AFTER </Bands>:
            <Watermark Ref="20" Text="DRAFT" Font="Arial, 72pt, style=Bold" ForeColor="Silver" TextTransparency="150" TextDirection="BackwardDiagonal" />
            - TextDirection is one of: Horizontal, ForwardDiagonal, BackwardDiagonal.
            - TextTransparency is 0-255 where 255 is opaque. A watermark meant to be read through is around 120-180; 0 makes it invisible, which is not what "transparency" suggests in either direction, so pick from that range rather than reasoning about it.
            - The element carries a Ref and NO ControlType, like every other non-control element.
            - **Only emit one when the source document actually shows one.** A pale diagonal word across the page is the evidence. Do not add DRAFT to a report because it looks like a draft.
            - **Do not write an image watermark.** DevExpress stores it as ImageSource="..." holding base64 image data, which cannot be authored as readable XML — the same reason XRRichText is refused. If the uploaded .repx has one, copy the ImageSource attribute across byte for byte and change nothing about it.
`;
/**
 * Sorting the detail rows.
 *
 * Measured with `RepxProbe emit-sort`. Three things a class reference would not
 * have said: the collection lives on the **DetailBand** rather than on the
 * report; `SortOrder` is written only for `Descending`; and `<SortFields>` and
 * `<GroupFields>` have *identical item shapes*, so only the parent element name
 * tells them apart.
 */
const SORTING_BLOCK = `          - SORTING THE DETAIL ROWS — a property of the band, not of the report.
            If the source document's rows are plainly in an order — by date, by customer, largest first — say so, or the report prints them in whatever order the data arrives.
            <Item3 Ref="4" ControlType="DetailBand" Name="Detail" HeightF="20">
              <SortFields>
                <Item1 Ref="5" FieldName="CustomerName" />
                <Item2 Ref="6" FieldName="OrderDate" SortOrder="Descending" />
              </SortFields>
              <Controls> ... </Controls>
            </Item3>
            - <SortFields> is a SIBLING of <Controls> and is written BEFORE it, exactly like <GroupFields> on a GroupHeaderBand.
            - **Write SortOrder ONLY for Descending.** Ascending is the default and DevExpress writes nothing at all for it — an item is just <Item1 Ref="5" FieldName="CustomerName" />. Writing SortOrder="Ascending" is not an error but it is not what the serializer produces.
            - Items carry FieldName and NO ControlType, like every other collection item.
            - Item order is sort precedence: the first field is the primary sort.
            - **A GroupHeaderBand's <GroupFields> already sorts by its own field.** Do not repeat that field in the Detail band's <SortFields> — the grouping did it, and a second sort on the same field says nothing.
            - Only sort by a field the data actually has. An order you can see in the printed page is evidence of a sort; a column heading is not.
`;

const CALCULATED_BLOCK = `          - CALCULATED FIELDS — a column the report can RECOMPUTE, not a number it remembers.
            An invoice line showing 3 x 12.50 = 37.50 has a total column that is arithmetic over two other columns. Written as the literal 37.50 it is correct once and wrong for every other row; written as a calculated field it is correct for all of them, which is the difference between a picture and a report.
            The collection is root-level and written BEFORE <Bands>, like <FormattingRuleSheet> and unlike <StyleSheet>:
            <CalculatedFields>
              <Item1 Ref="1" Name="LineTotal" FieldType="Decimal" Expression="[Quantity] * [UnitPrice]" />
            </CalculatedFields>
            - **No data source is required.** Name, FieldType and Expression are the whole of it — DataMember is written only when there is one, and there is not one here.
            - FieldType is one of: String, Int32, Decimal, Double, DateTime, Boolean, Guid. Write it every time; it is not omitted for a default the way SortOrder and CanGrow are.
            - A control uses it **exactly like a real field** — <ExpressionBindings> with Expression="[LineTotal]". Nothing in the reference says it is calculated.
            - Emit one ONLY where the arithmetic is visible in the source: a column whose printed values are plainly the product, sum or difference of two other columns on the same row. **Do not invent one from a column heading.** "Total" next to "Amount" is not evidence of a formula, and a calculated field with a guessed expression produces confidently wrong numbers on real data — worse than the literal it replaced.
            - Name it as the data would: LineTotal, Margin, FullName. The expression's operands must be field names that exist in the data, spelled as the data spells them.
`;

const RULES_BLOCK = `          - CONDITIONAL FORMATTING — a rule the report applies at print time, not a colour you saw once.
            "Print overdue amounts in red" is a rule. A single red figure in a scanned document is NOT evidence of one: it is one row that happened to be overdue on the day that page was printed, and you cannot see the condition from the result. **Do not invent a rule from an image.** Emit one only when the uploaded .repx already has it, or when the user asks for it in words.
            The sheet is a root-level collection written BEFORE <Bands> — note that this is the opposite side from <StyleSheet>, which is written after:
            <FormattingRuleSheet>
              <Item1 Ref="1" Name="OverdueRule" Condition="[DaysOverdue] &gt; 30">
                <Formatting Ref="2" ForeColor="Red" Font="Arial, 9pt, style=Bold" />
              </Item1>
            </FormattingRuleSheet>
            - The condition is an expression over the data, XML-escaped: &gt; and &lt; and &amp;, never a raw > or <.
            - A control or a BAND takes rules through a <FormattingRuleLinks> child, and each link is a **"#Ref-N" POINTER at the rule's Ref** — not its name:
              <FormattingRuleLinks><Item1 Ref="9" Value="#Ref-1" /></FormattingRuleLinks>
            - Link order is application order: a later link wins where two rules touch the same property.
            - Put the link on the BAND when the whole row changes, and on the control when one figure does. A row highlight expressed as a rule on every cell is the same picture and a worse report.
            - A rule nothing links is dead, and a link pointing at a Ref that is not a rule silently never fires. Both load without complaint.
`;

const CHECKBOX_BLOCK = `          - Checkbox: <Item7 Ref="9" ControlType="XRCheckBox" Name="checkBox1" Checked="true" CheckBoxState="Checked" Text="Paid in full" LocationFloat="0,320" SizeF="200,20" />
            - A tick, cross or filled square on a form line IS a checkbox. Do not draw one as a label containing "X" or a bordered empty label — those cannot be bound, cannot be toggled, and are the same failure as building a table out of labels.
            - The caption goes in Text, like every other control. The box itself is drawn by the control; do not add a separate label beside it.
            - **Only write the two state attributes for a TICKED box, and always write them as a pair.** Unchecked is the default and DevExpress writes neither attribute, so an empty box is just <Item ControlType="XRCheckBox" Text="..." />. Writing Checked without CheckBoxState, or either one with "false", is not what the serializer produces.
          - CHARACTER COMB — one boxed cell per character, which is how a form asks for a reference number, a postcode or an account number.
            <Item2 Ref="4" ControlType="XRCharacterComb" Name="combAccount" CellWidth="30" CellHeight="40" CellHorizontalSpacing="6" CellSizeMode="Custom" Text="SW1A1AA" SizeF="400,40" LocationFloat="0,60" />
            - **Every cell metric has a default and an untouched comb writes none of them** — just Text, SizeF and LocationFloat. Set CellWidth/CellHeight only when the source's boxes are a size you can measure, and set CellSizeMode="Custom" with them or they are ignored, the same pairing MultiColumn has between Mode and ColumnCount.
            - Borders are NOT written for a comb the way they are for other controls: All is its default, so a boxed comb needs no Borders attribute at all.
            - The text binds like a label's, and on a form filled from data that is what it should be: an <ExpressionBindings> item with PropertyName="Text".
            - **A row of boxes drawn as separate bordered labels is the wrong answer**, exactly as a grid of labels is the wrong answer for a table: it cannot be bound, and the character count is frozen into the layout.
`;

const CROSSBAND_BLOCK = `          - Cross-band lines and boxes — a vertical rule that runs THROUGH more than one band. **These do NOT go inside a band.** They form a <CrossBandControls> collection that is a SIBLING of <Bands>, written after </Bands>:
            <CrossBandControls><Item1 Ref="12" ControlType="XRCrossBandLine" Name="columnRule" WidthF="1" StartBand="#Ref-2" EndBand="#Ref-3" StartPointFloat="300,0" EndPointFloat="300,110" /></CrossBandControls>
            - StartBand and EndBand are **"#Ref-N" POINTERS at the Ref values of the band elements** — not names, not indexes. #Ref-2 means the band whose Ref="2". Point them at the wrong bands and the rule attaches in the wrong place with no error at all.
            - Use one when the source draws a column separator running from the heading row down through the detail rows, which is how most older table-heavy reports are ruled. **A vertical rule spanning bands cannot be an XRLine** — an XRLine lives inside one band and stops at its edge, so drawing the same thing with XRLines gives a rule that breaks at every band boundary.
            - Only for rules that genuinely cross a band boundary. A rule inside a single band is an XRLine, and a cell border is Borders= on the cell — reach for those first.
`;

const PANEL_BLOCK = `          - Panel — a bordered box that CONTAINS other controls: <Item8 Ref="10" ControlType="XRPanel" Name="panelBillTo" LocationFloat="100,100" SizeF="400,80" Borders="All"><Controls><Item1 Ref="11" ControlType="XRLabel" Name="billToName" Text="Acme Ltd" LocationFloat="10,10" SizeF="200,20" /></Controls></Item8>
            - **A child's LocationFloat is relative to the PANEL, not to the band.** A child at "10,10" inside a panel at "100,100" prints at 110,110 on the page. Writing band coordinates on a child pushes it outside the panel it belongs to, and the file still loads.
            - Use one for a boxed block on a form — a "Bill To" address box, a bordered summary, a signature block. One border on the panel replaces a border on each control, and the group stays together across a page break.
            - Do NOT use one just to draw a rectangle. A single bordered XRLabel, or Borders= on the cells, is the simpler answer, and a panel holding one control is always the wrong choice.
- **A BAND OF COLOUR BEHIND THE HEADER IS NOT A PANEL EITHER, AND THIS IS THE ONE THAT KEEPS HAPPENING.** A wide filled strip across the top of a design -- a coloured masthead, a tinted totals block, a banner behind the title -- is decoration, not a container. Emit it as an XRLabel with BackColor= and no Text, or as an XRShape with ShapeRectangle and FillColor=. An XRPanel with nothing inside it is a container holding nothing: it says "these controls belong together" about no controls, and the next person reading the file cannot tell whether the children went missing or were never there. Measured against DevExpress 20.1: XRShape has FillColor AND BackColor, XRLabel and XRPanel have BackColor only -- so a filled block never needs a panel.
          - **Embedded PDFs: do not create one.** XRPdfContent puts an existing PDF page inside the report, and it names that PDF one of two ways: SourceUrl="Terms.pdf", a path to a file that will not exist on the reader's machine, or SourceSerializable="...", the whole PDF as base64. Neither is something you can produce from a document you were shown — the first invents a filename, the second invents a file. If the uploaded .repx already has one, copy its SourceUrl or SourceSerializable across byte for byte and change nothing.
            - Its width is not settable: DevExpress forces it to the printable page width whatever SizeF says, so do not spend effort on the number. The height is honoured.
          - **Subreports: do not create one.** XRSubreport embeds an entire second report, and everything you are asked to produce belongs in ONE report expressed as bands. If the uploaded .repx already contains an XRSubreport, keep it exactly as it is — including a nested <ReportSource> if it has one — rather than expanding it into bands or dropping it.
`;

const SHAPES_BLOCK = `          - Shapes — a drawn rectangle, ellipse, line, arrow or bracket that is decoration rather than a container: <Item9 Ref="13" ControlType="XRShape" Name="shape1" LocationFloat="0,340" SizeF="200,80"><Shape Ref="14" ShapeName="Rectangle" /></Item9>
            - ShapeName is one of: Rectangle, Ellipse, Line, Arrow, Polygon, Star, Bracket, Brace, Cross. A Star also takes StarPointCount on the same element.
            - **Ellipse is the default and writes NO <Shape> element at all.** An XRShape with no child is an ellipse, so a rectangle must say so explicitly or it comes out round.
            - Reach for this last. A box around content is Borders= on the control or an XRPanel; a horizontal rule is an XRLine; a vertical rule crossing bands is an XRCrossBandLine. XRShape is for a genuine drawn figure — a callout arrow, a diagonal, a circle — that none of those can express.
          - **Rich text: do not create one.** XRRichText stores its content as SerializableRtfString, a base64-encoded UTF-16 RTF document — measured, not assumed. It cannot be authored as readable XML, and an approximation loads as an empty box with no error. A paragraph of terms and conditions is an XRLabel with WordWrap="true"; formatting that varies WITHIN a paragraph is the one thing this cannot express, and losing it is better than emitting a control that prints nothing. If the uploaded .repx already contains an XRRichText, copy its SerializableRtfString across byte for byte and change nothing about it.
`;

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
  if (isMockMode(viteEnv.VITE_FORMA_MOCK)) {
    console.warn("VITE_FORMA_MOCK is set — returning the mock invoice layout without calling Gemini.");
    // Simulate a 3-second network delay to allow testing loaders and status bars
    await sleep(3000, signal);
    if (viteEnv.VITE_FORMA_MOCK === MOCK_MISORDERED) {
      console.warn(
        `VITE_FORMA_MOCK="${MOCK_MISORDERED}" — the two header bands are swapped ON PURPOSE. ` +
          'The "1 REPX warning" in the status bar is the fixture, not the app.',
      );
      return {
        ...MOCK_INVOICE_RESPONSE,
        repxContent: misorderMockHeaders(MOCK_INVOICE_RESPONSE.repxContent),
      };
    }
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
   * generation came out 23.2 whatever the dropdown said -- a setting that looked
   * present and did nothing.
   *
   * This used to add that a .repx is rejected by an older designer than the one
   * it declares. It is not: measured 2026-09-06, a 24.1 file loads through the
   * installed 20.1 assemblies with nothing lost. The bug was that the dropdown
   * did not reach the output, which is worth fixing on its own.
   *
   * `X.Y.3.0` is the shape both observed real files use: Forma's own output
   * (23.2.3.0) and a template written by an installed 20.1 designer (20.1.3.0).
   * If a build number ever has to be exact, it belongs in a map keyed by version
   * rather than here.
   */
  const targetVersion = config?.version || '23.2';
  const targetSerializerVersion = `${targetVersion}.3.0`;

  /*
   * Which optional prompt sections this request needs.
   *
   * Everything is included unless the evidence positively rules a section out,
   * which in practice means: the source is an uploaded .repx and neither it, nor
   * the report being refined, nor the user's own words mention the feature. An
   * image or a PDF proves nothing about what the document contains, so it gets
   * the whole prompt -- see lib/promptSections.ts for why omitting on a guess is
   * the wrong trade here.
   *
   * Logged when anything is dropped, because "the model stopped emitting charts"
   * and "we stopped asking for charts" are indistinguishable from the outside.
   */
  const sections = sectionsFor({
    texts: imageParts.flatMap((part) => ('text' in part ? [part.text] : [])),
    previousRepx: previousState?.repxContent,
    instruction: prompt,
  });
  if (sections.length < ALL_SECTIONS.length) console.info(describeSections(sections));

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

  /* The band skeleton — ReportHeader / PageHeader / a ONE-ROW Detail /
     ReportFooter / PageFooter — rather than one page-sized DetailBand, which
     printed the whole page once per record the moment a data source was bound.
     There is no longer a flag for the old shape; see lib/reportBands.ts for why
     the fallback was removed rather than kept, and what depends on this text. */

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
  const requestFor = async (modelName: string): Promise<{ text: string; finishReason?: string; usage?: TokenUsage | null }> => {
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

    return { text, finishReason, usage: readTokenUsage(usage) };
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
          
${rootStructurePrompt({ page, reportUnit, targetVersion, targetSerializerVersion }, sections)}
          - Labels: <Item1 Ref="1" ControlType="XRLabel" Name="label1" Text="My Text" LocationFloat="0,10" SizeF="200,30" Padding="2,2,0,0,100" />
          - Tables — rows and cells, with cells sized by Weight and never by coordinates: <Item2 Ref="2" ControlType="XRTable" Name="table1" LocationFloat="0,50" SizeF="750,40" Borders="All"><Rows><Item1 Ref="3" ControlType="XRTableRow" Name="rowHeader" Weight="1"><Cells><Item1 Ref="4" ControlType="XRTableCell" Name="cellHeadDesc" Text="Description" Weight="3" Font="Arial, 9.75pt, style=Bold" /><Item2 Ref="5" ControlType="XRTableCell" Name="cellHeadAmount" Text="Amount" Weight="1" TextAlignment="MiddleRight" Font="Arial, 9.75pt, style=Bold" /></Cells></Item1><Item2 Ref="6" ControlType="XRTableRow" Name="row1" Weight="1"><Cells><Item1 Ref="7" ControlType="XRTableCell" Name="cellDesc1" Text="Widget" Weight="3" /><Item2 Ref="8" ControlType="XRTableCell" Name="cellAmount1" Text="1,240.00" Weight="1" TextAlignment="MiddleRight" /></Cells></Item2></Rows></Item2>
          - Images: <Item3 Ref="5" ControlType="XRPictureBox" Name="pictureBox1" Sizing="ZoomImage" LocationFloat="0,100" SizeF="150,150" />
          - Lines: <Item4 Ref="6" ControlType="XRLine" Name="line1" LocationFloat="0,260" SizeF="300,5" />
          - Page Info: <Item5 Ref="7" ControlType="XRPageInfo" Name="pageInfo1" PageInfo="DateTime" LocationFloat="0,270" SizeF="150,20" />
            - PageInfo is an ENUM and only these eight values exist: None, Number, NumberOfTotal, Total, RomLowNumber, RomHiNumber, DateTime, UserName. Anything else is dropped on load and the control prints nothing. Do NOT invent a value and do NOT combine two of them.
            - For "Page 1 of 12" use PageInfo="NumberOfTotal" with TextFormatString="Page {0} of {1}". For a bare number use PageInfo="Number". The property is **TextFormatString**, NOT Format — a real generation emitted Format= and PageInfo="NumberOfPagesNoWith  PageNumber" on 2026-09-04, and DevExpress discarded the page numbering without a word.
          - Barcode: <Item6 Ref="8" ControlType="XRBarCode" Name="barcode1" LocationFloat="0,300" SizeF="200,50"><Symbology Name="Code128" /></Item6>
${sections.includes('gauges') ? GAUGES_BLOCK : ''}${sections.includes('bookmarks') ? BOOKMARKS_BLOCK : ''}${sections.includes('columns') ? COLUMNS_BLOCK : ''}${sections.includes('watermark') ? WATERMARK_BLOCK : ''}${sections.includes('sorting') ? SORTING_BLOCK : ''}${sections.includes('calculated') ? CALCULATED_BLOCK : ''}${sections.includes('rules') ? RULES_BLOCK : ''}${sections.includes('checkbox') ? CHECKBOX_BLOCK : ''}${sections.includes('crossband') ? CROSSBAND_BLOCK : ''}${sections.includes('containers') ? PANEL_BLOCK : ''}${sections.includes('shapes') ? SHAPES_BLOCK : ''}          Always use standard DevExpress.XtraReports.UI components. Ensure LocationFloat and SizeF use comma without spaces for numbers (e.g. "150.5,20.3").

          - AN ALIGNED, REPEATING REGION IS A TABLE. FINDING IT IS PART OF THE JOB.
            Before you place a single label, look for the repeating structures. Wherever two or more rows share the same column positions, that region is a table — line items, schedules, price lists, specification grids, timesheets, statements, any list of things with the same fields. Emit it as real XRTable / XRTableRow / XRTableCell structure; how many of its rows go into repxContent is settled at the end of this block.
            - **Visible rules are not required, and their absence is not evidence.** Columns that line up are the signal. A region drawn with no borders at all is still a table; so is one separated only by a single rule under the headings.
            - **A grid of XRLabels is always the wrong answer for such a region**, however exactly its coordinates match the source. It looks identical in a preview and is a failed report: those columns cannot be re-bound to data, resized, or repeated per record, which is the whole purpose of the file being a .repx instead of a picture.
            - Column widths are relative Weight values on the cells, not coordinates — a column twice as wide as its neighbour gets twice the Weight. **An XRTableCell has no LocationFloat and no SizeF**; do not compute them. The XRTable's own SizeF sets the width the weights are distributed across.
            - Carry the source's own formatting onto the cells: bold the header row, and give money, quantity and date columns a TextAlignment ending in Right if that is how they are set.
            - ${tableRowsRule()}
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
          - **THE TAG NAME AND THE Ref ARE TWO DIFFERENT NUMBERS. NEVER MAKE THEM MATCH.** Get this wrong and the report opens with no error and its tables missing.
            - **The tag name ItemN is the element's POSITION IN ITS OWN COLLECTION, and it RESTARTS AT Item1 inside every single container.** Every <Bands>, <Controls>, <Rows>, <Cells> starts again from Item1: <Rows><Item1 ...><Item2 ...></Rows>, and inside each of those rows <Cells><Item1 ...><Item2 ...></Cells>. DevExpress finds a collection's members BY THIS NAME, so a <Cells> whose first child is Item14 contains no Item1 and is read as an EMPTY collection — the cells are discarded silently and the table vanishes.
            - **Ref is the opposite: ONE sequence for the whole document, and every value must be different.** Ref="0" on the root, then 1, 2, 3 ... to the last element, counting bands, controls, rows and cells together, never restarting. Two elements sharing a Ref are loaded as ONE object and the second one's content is DISCARDED SILENTLY.
            - So a table's second row is <Item2 Ref="19" ...> — Item2 because it is the second row in <Rows>, Ref="19" because nineteen elements came before it in the file. The two numbers have no relationship. Do NOT copy Ref values out of the examples below; each example restarts from a low number and is not a numbering scheme for the whole file.
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
                  { "id": "el-1", "type": "label" | "table" | "chart" | "gauge" | "image" | "line" | "barcode" | "checkbox", "content": "Text or description", "x": 10, "y": 10, "width": 200, "height": 30, "color": "#000000", "backgroundColor": "#ffffff", "fontSize": 12 }
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

          ${instructionBlock(prompt, { hasPreviousState: Boolean(previousState?.repxContent) })}` },
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
                          type: { type: Type.STRING, enum: ["label", "table", "chart", "gauge", "image", "line", "barcode", "checkbox"] },
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
${rootStructurePrompt({ page, reportUnit, targetVersion, targetSerializerVersion }, sections)}
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
    // Carried onto the result so the status bar can show it. The console line
    // above stays: it is the only record when a run fails before this point.
    parsed.usage = response.usage ?? null;
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
    // Before everything, including the Ref repair. `ItemN` is a position inside
    // its own collection and restarts at Item1 in each one; a model that runs
    // the names straight through the document produces collections DevExpress
    // reads as empty, and the tables disappear on load with no error. Observed
    // on a real generation: 3 tables and 44 cells declared, 0 and 0 loaded.
    // See `repxItems.ts` — including the part where the prompt caused it.
    const items = normalizeItemNames(parsed.repxContent);
    if (items.applied) {
      parsed.repxContent = items.xml;
      console.warn(`REPX item numbering repaired: ${items.reason}.`);
    } else {
      console.debug(`REPX item numbering: ${items.reason}.`);
    }

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

    // A parameter's type is the one thing in this file the model CANNOT write
    // correctly, and the failure is silent: DevExpress accepts an inline
    // `Type="System.DateTime"` and loads a String holding the date as text, so
    // the report's date filter then compares strings. The real form is a
    // `#Ref-N` pointer into an `<ObjectStorage>` block, which needs a Ref
    // unique across a section the model never sees. Measured 2026-09-05; see
    // `repxParameters.ts`. Not behind a flag, because leaving it off means
    // shipping a parameter that is quietly the wrong type.
    const params = liftParameterTypes(parsed.repxContent, targetVersion);
    if (params.applied) {
      parsed.repxContent = params.xml;
      console.log(`Parameters: ${params.reason}.`);
    } else {
      console.log(`Parameters left as generated: ${params.reason}.`);
    }

    /*
     * Shared appearance onto a <StyleSheet>, last of the output passes.
     *
     * Last on purpose: it reads every control's attributes and rewrites the ones
     * it hoists, so anything that also edits attributes -- the margin lift, the
     * parameter lift -- has to have finished. Running it earlier would let a
     * later pass write an attribute onto a control whose twin had already had
     * that attribute removed, splitting a group that was equal when it was
     * measured.
     *
     * Also the least consequential if it declines: a report without a style
     * sheet prints exactly the same, it is merely tedious to restyle. That is
     * why it is allowed to decline for any reason at all and only logs.
     */
    const styles = liftStyles(parsed.repxContent);
    if (styles.applied) {
      parsed.repxContent = styles.xml;
      console.log(`Styles: ${styles.reason}.`);
    } else {
      console.log(`Styles left as generated: ${styles.reason}.`);
    }

    /*
     * There is deliberately no binding pass here any more.
     *
     * Until 2026-09-05 a `VITE_FORMA_BIND` flag ran `bindDetailRow` over every
     * generation, binding each column to a field name DERIVED from its heading
     * -- "Item Description" becoming `[ItemDescription]`. That is the report's
     * guess about what its own data is called, and against a source whose
     * column is really `DESCR` it produces a file that opens cleanly and fails
     * when it runs.
     *
     * The Data tab replaced it: the user pastes a real schema and chooses the
     * mapping, so the names come from the data rather than from the document.
     * Keeping a flag that writes the guess would mean maintaining two answers
     * to the same question, one of which is known to be worse -- and a flag
     * nobody turns on is a code path nobody tests. Binding is now a deliberate
     * action with a real schema behind it, or it does not happen.
     */

    // Last, on the finished artifact, and it repairs nothing: this asks what is
    // still wrong after every repair has run. An error here means a repair
    // declined rather than that nobody looked, which is worth knowing about.
    // See `repxAudit.ts`; the UI shows the findings beside the REPX.
    const audit = auditRepx(parsed.repxContent, parsed.layout);
    if (audit.errors) {
      console.error(`REPX audit — ${audit.summary}.`);
    } else if (audit.warnings) {
      console.warn(`REPX audit — ${audit.summary}.`);
    } else {
      console.log(`REPX audit — ${audit.summary}.`);
    }
    for (const finding of audit.findings) {
      console[finding.severity === 'error' ? 'error' : 'warn'](`  [${finding.code}] ${finding.message}`);
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