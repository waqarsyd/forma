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
 * ## The distinction this function exists to draw
 *
 * A truncated body is still a body. The model writes most of the report, runs
 * out of output budget, and stops mid-string; the JSON is unparseable in
 * exactly the way genuine nonsense is unparseable. **Only `finishReason`
 * separates them.**
 *
 * Getting that wrong is wrong twice over. It blames the model for output that
 * was fine as far as it got, and it tells the user to try again — which, for
 * the same input, fails the same way every time. That was the behaviour until
 * 2026-08-26: `finishReason` was consulted only when the response came back
 * *empty*, so the far more common partial case fell through to "malformed".
 *
 * Where there is no `finishReason`, this says malformed and means it. Guessing
 * truncation from the shape of the text would be worse than admitting the
 * signal is absent.
 */
import type { AnalysisResponse } from './reportTypes';

/** The subset of `finishReason` values that change what the user should do. */
const MAX_TOKENS = 'MAX_TOKENS';
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT']);

/**
 * Parse a completed generation.
 *
 * @param text the raw response body, as received
 * @param finishReason Google's stop reason, if it reported one
 * @throws Error with a message written for the user, never a bare parse error
 */
export function parseAnalysisResponse(
  text: string | undefined,
  finishReason: string | undefined
): AnalysisResponse {
  const rawText = text?.trim();

  // An empty body used to be parsed as "{}" and returned as a success, so a
  // blocked or truncated generation surfaced much later as a render crash on a
  // missing `layout.sections`. Fail here, where the cause is still visible.
  if (!rawText) {
    if (finishReason === MAX_TOKENS) {
      throw new Error(
        'The report was too large to finish generating. Try a simpler design, or split it across two requests.'
      );
    }
    if (BLOCKED.has(finishReason ?? '')) {
      throw new Error('Gemini blocked this request under its safety filters. Try a different source image or prompt.');
    }
    throw new Error('Gemini returned an empty response. Try generating again.');
  }

  try {
    const parsed = JSON.parse(rawText) as AnalysisResponse;
    if (!parsed?.layout?.sections) {
      // Schema-valid JSON that is missing the part the mockup renders.
      throw new Error('missing layout');
    }
    return parsed;
  } catch {
    if (finishReason === MAX_TOKENS) {
      throw new Error(
        'The report was cut off before it finished — the model reached its output limit part-way through. ' +
          'This design is too large to return in one response: try a simpler page, upload fewer pages at once, ' +
          'or split it into two requests. Generating again with the same input will hit the same limit.'
      );
    }
    if (BLOCKED.has(finishReason ?? '')) {
      throw new Error('Gemini stopped part-way under its safety filters. Try a different source image or prompt.');
    }
    throw new Error('The AI returned a malformed report. Try generating again.');
  }
}
