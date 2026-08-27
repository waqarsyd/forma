/**
 * The progress bar's state machine, as data.
 *
 * Extracted from `App.tsx` on 2026-08-27 (audit ARC-001/ARC-002). It was five
 * pieces of component state driven by a `setInterval` callback and two
 * `useCallback`s, duplicated across `handleGenerate` and `handleResume` — so
 * nothing here could be reached by a test, and the two copies could drift.
 *
 * ## The two phases, and the seam between them
 *
 * Generation takes a minute or more and produces **no signal at all** for the
 * first stretch of it: model detection, upload, and the model's own silent
 * thinking pass. So the opening phase is *simulated* on a timer, and the rest
 * is *real*, fed by the streamed response.
 *
 * The seam is where this broke before. The simulation used to climb freely, so
 * by the time the first real chunk arrived reporting 2%, the bar snapped
 * backwards. Two rules hold it together: the simulated phase is capped at
 * `PRE_STREAM_CEILING`, and the streamed phase starts above it. Both are
 * enforced here rather than remembered at the call site.
 *
 * Nothing in this module throws, and every failure it prevents is a *plausible*
 * one — a bar that jumps, stalls, or finishes early. The only way to catch
 * those by hand is to watch a real generation and be looking at the right
 * moment, which is why they are pinned by tests instead.
 */

/** What the user is told is happening, in order. */
export const ANALYZING_STEPS = [
  'Analyzing input request and images...',
  'Extracting layout boundaries and sections...',
  'Generating spatial map...',
  'Constructing DevExpress XML...',
  'Refining mockup layout...',
  'Finalizing result...',
] as const;

/**
 * How far the simulated opening phase may climb.
 *
 * Deliberately small. This stretch is guesswork, and leaving the rest of the
 * bar for output that genuinely arrived is what makes the handover invisible.
 */
export const PRE_STREAM_CEILING = 14;

/** How often the simulated phase advances a step. */
export const STEP_INTERVAL_MS = 2500;

export interface GenerationProgress {
  /** Index into `ANALYZING_STEPS`. */
  stepIndex: number;
  /** 0-100. Only `finishProgress` reaches 100. */
  percent: number;
  /** Characters of response received so far. A fact, not a smoothed value. */
  streamChars: number;
}

/**
 * Nothing running.
 *
 * Distinct from `startProgress()`, which already shows a few percent: this is
 * what the state resets to when a run finishes and the panel is hidden, so a
 * new run does not briefly inherit the old one's bar.
 */
export const IDLE_PROGRESS: GenerationProgress = Object.freeze({
  stepIndex: 0,
  percent: 0,
  streamChars: 0,
});

/** Where the simulated bar sits at a given step. */
function simulatedPercent(stepIndex: number): number {
  return Math.min(PRE_STREAM_CEILING, 4 + stepIndex * 2);
}

function clampStep(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(ANALYZING_STEPS.length - 1, Math.max(0, Math.floor(index)));
}

/**
 * Begin a run.
 *
 * `fromStep` is for resume: the request is re-issued from the beginning, but
 * the bar stays where it was rather than snapping backwards on an action the
 * user took deliberately. `streamChars` resets either way — output from the
 * abandoned attempt no longer counts toward this one.
 */
export function startProgress(fromStep: number = 0): GenerationProgress {
  const stepIndex = clampStep(fromStep);
  return { stepIndex, percent: simulatedPercent(stepIndex), streamChars: 0 };
}

/** One tick of the simulated phase. Stops at the last step. */
export function tickSimulated(state: GenerationProgress): GenerationProgress {
  const stepIndex = clampStep(state.stepIndex + 1);
  return {
    ...state,
    stepIndex,
    // Monotonic, like everything else here — see `advance`.
    percent: Math.max(state.percent, simulatedPercent(stepIndex)),
  };
}

/**
 * A chunk arrived.
 *
 * Two things are deliberate. The percentage is floored at
 * `PRE_STREAM_CEILING + 1`, which is what stops the handover moving the bar
 * backwards. And it is **also** floored at whatever the bar already showed: the
 * stream scanner derives its percentage from a total length it cannot know in
 * advance, so it is not monotonic on its own.
 *
 * `streamChars` is not smoothed. It is a count of what arrived, and showing it
 * going backwards would be a lie about a real number.
 */
export function applyStreamProgress(
  state: GenerationProgress,
  chunk: { percent: number; chars: number }
): GenerationProgress {
  const reported = Number.isFinite(chunk.percent) ? chunk.percent : 0;
  const percent = Math.max(state.percent, PRE_STREAM_CEILING + 1, reported);

  return {
    stepIndex: clampStep((reported / 100) * ANALYZING_STEPS.length),
    // Never 100: only a parsed result finishes the bar. Approaching completion
    // without arriving is the honest shape for a length nobody knows yet.
    percent: Math.min(percent, 99.9),
    streamChars: Number.isFinite(chunk.chars) ? chunk.chars : state.streamChars,
  };
}

/** The run produced a result. This is the only thing that reaches 100. */
export function finishProgress(state: GenerationProgress): GenerationProgress {
  return { ...state, stepIndex: ANALYZING_STEPS.length - 1, percent: 100 };
}

/** The label for the current step. Never undefined, whatever the index. */
export function stepLabel(state: GenerationProgress): string {
  return ANALYZING_STEPS[clampStep(state.stepIndex)];
}
