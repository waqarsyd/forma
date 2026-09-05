/**
 * Which optional prompt sections this request actually needs.
 *
 * ## The problem, and the trap in the obvious solution
 *
 * The prompt is ~40 kB, and roughly a fifth of it teaches syntax most documents
 * never use: grouping bands, parameters, charts and cross-tabs, checkboxes and
 * cross-band rules. An invoice with a flat table pays for all of it on every
 * generation.
 *
 * The obvious fix — leave a section out when the document does not need it — has
 * a failure mode worse than the cost. **Whether a document contains a chart is
 * something only the model can tell us**, after it has looked, and by then the
 * prompt has been sent. Guessing wrong in the omitting direction does not
 * produce an error: it produces a report where the chart was drawn as labels and
 * rectangles, because nothing ever told the model that `XRChart` exists. That is
 * the silent-quality-regression class this project treats as the worst kind, and
 * it would show up as "the model got lazy" rather than as a prompt change.
 *
 * ## So: omit only on proof, never on a guess
 *
 * Everything is included by default. A section is dropped **only** when the
 * source is an uploaded `.repx` — the one case where the input states exactly
 * what the report contains — and neither that file, nor the report being
 * refined, nor anything the user typed shows any sign of the feature.
 *
 * That deliberately means this does nothing at all for an image or a PDF, which
 * is the common path. It is not a general optimisation and should not be made
 * into one. It fires on `.repx` intake, which is the **batch migration** path —
 * forty legacy files, one request each, where the saving is multiplied and the
 * evidence is exact.
 *
 * ## Reading the signals
 *
 * Every signal errs toward inclusion. A keyword list that is too broad costs a
 * section that was not needed; one that is too narrow costs a feature the report
 * should have had. Those are not symmetric, so the lists below are deliberately
 * generous — `box` and `rule` match far more than checkboxes and cross-band
 * lines, and that is the right way round.
 */

export type PromptSection = 'grouping' | 'parameters' | 'charts' | 'containers';

export const ALL_SECTIONS: readonly PromptSection[] = [
  'grouping',
  'parameters',
  'charts',
  'containers',
];

export interface SectionEvidence {
  /**
   * The text parts of the request. An uploaded `.repx` arrives as one of these,
   * as does a PDF's extracted text layer.
   */
  texts?: readonly string[];
  /** The report being refined, on a refinement turn. */
  previousRepx?: string | null;
  /** What the user typed alongside the attachments. */
  instruction?: string | null;
}

/**
 * Does any text part look like a report file rather than page text?
 *
 * The root element is the discriminator, and it has to be the root element
 * rather than the word "repx" anywhere: a PDF whose text layer happens to
 * mention a filename is page text, not a source of structural truth, and
 * treating it as one is how this stops being conservative.
 */
function repxSourceIn(texts: readonly string[]): string | null {
  for (const text of texts) {
    if (text.includes('XtraReportsLayoutSerializer')) return text;
  }
  return null;
}

/** Markers in a `.repx` that prove a feature is present. */
const XML_SIGNALS: Record<PromptSection, RegExp> = {
  grouping: /GroupHeaderBand|GroupFooterBand|<GroupFields|Running="Group"/i,
  parameters: /<Parameters\b|\[Parameters\.|FilterString\s*=\s*"[^"]*\?/i,
  charts: /XRChart|XRCrossTab|XRPivotGrid|XRSparkline/i,
  containers: /XRCheckBox|XRPanel|XRSubreport|XRCrossBand/i,
};

/**
 * Words in the user's instruction that mean "I may want this", generously.
 *
 * Matched against the instruction only. Matching them against a PDF's text layer
 * would fire on the word "total" in any invoice and defeat the whole thing,
 * while matching them against the `.repx` would be redundant with the markers
 * above and much less precise.
 */
const WORD_SIGNALS: Record<PromptSection, RegExp> = {
  grouping: /\bgroup|\bsubtotal|\bbreak\b|\bper (region|customer|category|department)\b/i,
  parameters: /\bparameter|\bprompt\b|\bdate range\b|\bfilter|\bask the (reader|user)\b/i,
  charts: /\bchart|\bgraph|\bplot\b|cross.?tab|\bpivot|\bmatrix\b/i,
  containers: /\bcheck ?box|\btick\b|\bpanel\b|\bbox\b|\bsubreport|\brule\b|\bborder/i,
};

/**
 * The sections to include for this request.
 *
 * Returns every section unless the evidence positively rules one out — see the
 * header. The result is a new array each call and is safe to mutate.
 */
export function sectionsFor(evidence: SectionEvidence = {}): PromptSection[] {
  const texts = evidence.texts ?? [];
  const source = repxSourceIn(texts);

  // No .repx in the request: nothing here can prove absence, so everything
  // stays. This is the image and PDF path, and it is the common one.
  if (!source) return [...ALL_SECTIONS];

  const previous = evidence.previousRepx ?? '';
  const instruction = evidence.instruction ?? '';

  return ALL_SECTIONS.filter((section) => {
    const xml = XML_SIGNALS[section];
    if (xml.test(source) || xml.test(previous)) return true;
    return WORD_SIGNALS[section].test(instruction);
  });
}

/**
 * A one-line note for the console, so a short prompt is explicable.
 *
 * Without this, "the model stopped emitting charts" and "we stopped asking for
 * charts" look identical from the outside, and the second is the one nobody
 * thinks to check.
 */
export function describeSections(sections: readonly PromptSection[]): string {
  const omitted = ALL_SECTIONS.filter((s) => !sections.includes(s));
  if (omitted.length === 0) return 'prompt: all optional sections included';
  return `prompt: omitted ${omitted.join(', ')} — the uploaded .repx shows no sign of them`;
}
