/**
 * Turning what the model returned into a report, or into a message that says
 * why it isn't one.
 *
 * Extracted from the bottom of `analyzeReportDesign` on 2026-08-27 (audit
 * TEST-002) because it was the least reachable important code in the project:
 * a branch that decides what a user sees when generation fails, sitting behind
 * a real key, a real request, and a model that had to be persuaded to fail in a
 * particular way. The truncation case was originally verified by fulfilling a
 * stream with 62% of a valid payload over CDP — careful work that could only be
 * done once, by hand. It is now a fixture.
 *
 * ## The answer is the REPX (2026-11-05)
 *
 * Until this date the model answered with one JSON object holding a markdown
 * spec, a `layout` for the Mockup and the REPX, and this parsed it. The model
 * now answers with the REPX as raw XML and Forma reads the other two out of
 * it (lib/repxViews.ts); `parseAnalysisResponse` went with the JSON
 * (`git log -S"parseAnalysisResponse"`). A model that wraps the document in a
 * fence or a sentence is unwrapped by `extractRepxDocument`, and one that
 * answers in the old JSON shape anyway, as a local model may, has its
 * `repxContent` taken out of it.
 *
 * ## The distinction this function exists to draw
 *
 * A truncated body is still a body. The model writes most of the report, runs
 * out of output budget, and stops mid-tag; the XML is unfinished in exactly
 * the way genuine nonsense is unfinished. **Only `finishReason` separates
 * them.**
 *
 * Getting that wrong is wrong twice over. It blames the model for output that
 * was fine as far as it got, and it tells the user to try again — which, for
 * the same input, fails the same way every time. That was the behaviour until
 * 2026-08-26: `finishReason` was consulted only when the response came back
 * *empty*, so the far more common partial case fell through to "malformed".
 *
 * An unfinished document with a normal `finishReason` is returned rather than
 * refused: the request loop has already retried it as an output failure, and
 * the audit names what is missing.
 */
import { checkRepxComplete, extractRepxDocument } from './repxTruncation';

/** The subset of `finishReason` values that change what the user should do. */
const MAX_TOKENS = 'MAX_TOKENS';
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT']);

const CUT_OFF =
  'The report was cut off before it finished — the model reached its output limit part-way through. ' +
  'This design is too large to return in one response: try a simpler page, upload fewer pages at once, ' +
  'or split it into two requests. Generating again with the same input will hit the same limit.';

/**
 * The query the AI named for a shared database (2026-11-09, the SQL Server
 * programme, item 22): one `<?forma-query {...}?>` anywhere in its answer,
 * taken out before anything parses the REPX, so neither the extraction nor a
 * repair has to know about it and DevExpress never sees it. The JSON is
 * returned as read; `databaseAi.ts` holds it to the layout. A processing
 * instruction because one can sit before the root and carry any text but
 * `?>`, and because the corrected-draft path, which is not XML, can lift it
 * the same way.
 */
export function takeQueryInstruction(text: string): { text: string; query?: unknown } {
  const m = /<\?forma-query\s+([\s\S]*?)\?>\s*/.exec(text);
  if (!m) return { text };
  const rest = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  try {
    return { text: rest, query: JSON.parse(m[1]) };
  } catch {
    return { text: rest, query: m[1].trim() };
  }
}

/**
 * The REPX in a model's answer: the document itself, unwrapped from a fence,
 * a sentence of preamble or an old-style JSON answer.
 */
export function repxOfAnswer(text: string | undefined | null): string {
  const raw = text?.trim() ?? '';
  if (raw.startsWith('{')) {
    try {
      const json = JSON.parse(raw) as { repxContent?: unknown };
      if (typeof json.repxContent === 'string') return extractRepxDocument(json.repxContent);
    } catch {
      // Not JSON after all, or JSON cut off part-way: read it as text.
    }
  }
  return extractRepxDocument(raw);
}

/**
 * Read a completed generation's answer.
 *
 * @param text the raw response body, as received
 * @param finishReason Google's stop reason, if it reported one
 * @throws Error with a message written for the user, never a bare parse error
 */
export function parseRepxAnswer(text: string | undefined, finishReason: string | undefined): { repxContent: string } {
  const rawText = text?.trim();

  if (!rawText) {
    if (finishReason === MAX_TOKENS) {
      throw new Error('The report was too large to finish generating. Try a simpler design, or split it across two requests.');
    }
    if (BLOCKED.has(finishReason ?? '')) {
      throw new Error('Gemini blocked this request under its safety filters. Try a different source image or prompt.');
    }
    throw new Error('Gemini returned an empty response. Try generating again.');
  }

  const repxContent = repxOfAnswer(rawText);
  const started = repxContent.includes('<XtraReportsLayoutSerializer');
  const complete = started && checkRepxComplete(repxContent).complete;
  if (!complete && finishReason === MAX_TOKENS) throw new Error(CUT_OFF);
  if (!complete && BLOCKED.has(finishReason ?? '')) {
    throw new Error('Gemini stopped part-way under its safety filters. Try a different source image or prompt.');
  }
  if (!started) throw new Error('The AI answered without a report. Try generating again.');
  return { repxContent };
}
