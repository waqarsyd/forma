/**
 * The progress bar's state machine.
 *
 * It lived inside `handleGenerate` and `handleResume` as loose `setInterval`
 * callbacks and `useCallback`s over five pieces of component state, so none of
 * it could be reached by a test (audit ARC-001/ARC-002). Every invariant below
 * fails *plausibly* rather than loudly: the bar jumps, or stalls, or finishes
 * early. Nothing throws, and the only way to notice is to watch a real
 * minute-long generation and be looking at the right moment.
 *
 * The one that has already broken once is the handover. The opening phase is
 * simulated — model detection, upload and the model's silent thinking produce
 * no signal at all — and the streamed phase is real. When the simulation was
 * allowed to climb freely, the first real chunk reported a much lower figure
 * and the bar snapped backwards.
 */
import { describe, it, expect } from 'vitest';
import {
  ANALYZING_STEPS,
  PRE_STREAM_CEILING,
  IDLE_PROGRESS,
  startProgress,
  tickSimulated,
  applyStreamProgress,
  finishProgress,
  stepLabel,
  type GenerationProgress,
} from './generationProgress';

/** Run the simulated phase n times, as the interval would. */
const tickN = (state: GenerationProgress, n: number) => {
  let s = state;
  for (let i = 0; i < n; i++) s = tickSimulated(s);
  return s;
};

describe('IDLE_PROGRESS', () => {
  it('shows nothing, which startProgress deliberately does not', () => {
    expect(IDLE_PROGRESS.percent).toBe(0);
    expect(IDLE_PROGRESS.streamChars).toBe(0);
    expect(startProgress().percent).toBeGreaterThan(0);
  });

  it('cannot be mutated by a caller', () => {
    // It is module-level and shared; a caller that edited it would poison every
    // later run in the session.
    expect(() => {
      (IDLE_PROGRESS as { percent: number }).percent = 50;
    }).toThrow();
    expect(IDLE_PROGRESS.percent).toBe(0);
  });
});

describe('startProgress', () => {
  it('starts at the first step with a little progress showing', () => {
    const s = startProgress();
    expect(s.stepIndex).toBe(0);
    expect(s.percent).toBeGreaterThan(0);
    expect(s.streamChars).toBe(0);
  });

  it('resumes from the step the run had reached', () => {
    // Resume re-issues the whole request, but the bar must not snap backwards
    // on an action the user took deliberately.
    const s = startProgress(3);
    expect(s.stepIndex).toBe(3);
    expect(s.percent).toBeGreaterThan(startProgress(0).percent);
  });

  it('clamps a nonsense starting step rather than indexing past the labels', () => {
    for (const from of [-5, 99, NaN]) {
      const s = startProgress(from);
      expect(s.stepIndex).toBeGreaterThanOrEqual(0);
      expect(s.stepIndex).toBeLessThan(ANALYZING_STEPS.length);
      expect(stepLabel(s)).toBeTruthy();
    }
  });

  it('clears any stream count from a previous attempt', () => {
    expect(startProgress(4).streamChars).toBe(0);
  });
});

describe('the simulated opening phase', () => {
  it('advances one step at a time', () => {
    let s = startProgress();
    expect(tickSimulated(s).stepIndex).toBe(1);
    s = tickN(s, 3);
    expect(s.stepIndex).toBe(3);
  });

  it('stops at the last step instead of running off the end', () => {
    const s = tickN(startProgress(), 50);
    expect(s.stepIndex).toBe(ANALYZING_STEPS.length - 1);
    expect(stepLabel(s)).toBe(ANALYZING_STEPS[ANALYZING_STEPS.length - 1]);
  });

  it('never climbs past the ceiling, however long the model thinks', () => {
    // This is the guard that makes the handover possible. Without it the
    // simulation reaches 80% while nothing has actually happened.
    let s = startProgress();
    for (let i = 0; i < 200; i++) {
      s = tickSimulated(s);
      expect(s.percent).toBeLessThanOrEqual(PRE_STREAM_CEILING);
    }
  });

  it('keeps the ceiling visibly small, because this stretch is guesswork', () => {
    expect(PRE_STREAM_CEILING).toBeLessThan(25);
  });

  /**
   * The two constants are balanced, and nothing else says so.
   *
   * The last step lands on 4 + (6-1) * 2 = 14, exactly the ceiling — so the
   * `Math.min` guarding it is currently redundant, which a mutation test found
   * by deleting it and breaking nothing. **Adding a seventh step would push the
   * simulated phase to 16 and past the ceiling**, and the only symptom would be
   * the handover snapping the bar backwards again on the first real chunk.
   *
   * This is the assertion that fails when someone adds a step, which is the
   * moment the coupling actually matters.
   */
  it('the last simulated step lands at or under the ceiling', () => {
    const lastStepPercent = 4 + (ANALYZING_STEPS.length - 1) * 2;
    expect(lastStepPercent).toBeLessThanOrEqual(PRE_STREAM_CEILING);
  });
});

describe('the streamed phase', () => {
  it('takes over above the ceiling, so the bar cannot snap backwards', () => {
    // The bug this exists for: the simulation has climbed to the ceiling, then
    // the first real chunk reports 2%.
    const simulated = tickN(startProgress(), 10);
    const s = applyStreamProgress(simulated, { percent: 2, chars: 100 });
    expect(s.percent).toBeGreaterThan(PRE_STREAM_CEILING);
    expect(s.percent).toBeGreaterThanOrEqual(simulated.percent);
  });

  it('follows real progress once it is above the ceiling', () => {
    const s = applyStreamProgress(startProgress(), { percent: 60, chars: 9000 });
    expect(s.percent).toBe(60);
    expect(s.streamChars).toBe(9000);
  });

  it('moves the step label in step with the real percentage', () => {
    const early = applyStreamProgress(startProgress(), { percent: 10, chars: 1 });
    const late = applyStreamProgress(startProgress(), { percent: 90, chars: 9000 });
    expect(late.stepIndex).toBeGreaterThan(early.stepIndex);
    expect(late.stepIndex).toBeLessThan(ANALYZING_STEPS.length);
  });

  it('does not index past the last label at 100%', () => {
    const s = applyStreamProgress(startProgress(), { percent: 100, chars: 20000 });
    expect(s.stepIndex).toBe(ANALYZING_STEPS.length - 1);
    expect(stepLabel(s)).toBeTruthy();
  });
});

describe('progress only ever moves forward', () => {
  it('ignores a lower figure from a later chunk', () => {
    // The scanner reports a percentage derived from a length it cannot know in
    // advance, so it is not guaranteed monotonic on its own.
    let s = applyStreamProgress(startProgress(), { percent: 70, chars: 8000 });
    s = applyStreamProgress(s, { percent: 40, chars: 9000 });
    expect(s.percent).toBe(70);
  });

  it('still records the newer character count', () => {
    // The count is a fact about what arrived; only the bar is smoothed.
    let s = applyStreamProgress(startProgress(), { percent: 70, chars: 8000 });
    s = applyStreamProgress(s, { percent: 40, chars: 9000 });
    expect(s.streamChars).toBe(9000);
  });

  it('holds across the whole life of a run', () => {
    // A run as it really goes: simulated ticks, then chunks arriving out of
    // order, then completion.
    let s = startProgress();
    let last = s.percent;
    const script = [3, 3, 3, 3, 3, 3];
    for (const t of script) {
      s = tickN(s, t);
      expect(s.percent).toBeGreaterThanOrEqual(last);
      last = s.percent;
    }
    for (const percent of [2, 30, 25, 55, 50, 80, 95, 90]) {
      s = applyStreamProgress(s, { percent, chars: 1000 });
      expect(s.percent).toBeGreaterThanOrEqual(last);
      last = s.percent;
    }
    s = finishProgress(s);
    expect(s.percent).toBe(100);
  });
});

describe('finishProgress', () => {
  it('completes the bar', () => {
    expect(finishProgress(startProgress()).percent).toBe(100);
  });

  it('is the only thing that reaches 100', () => {
    // The streamed percentage deliberately approaches completion without
    // arriving: only a parsed result finishes the bar.
    let s = startProgress();
    s = tickN(s, 100);
    s = applyStreamProgress(s, { percent: 99.9, chars: 50000 });
    expect(s.percent).toBeLessThan(100);
  });
});

describe('stepLabel', () => {
  it('names every step', () => {
    for (let i = 0; i < ANALYZING_STEPS.length; i++) {
      expect(stepLabel({ stepIndex: i, percent: 0, streamChars: 0 })).toBe(ANALYZING_STEPS[i]);
    }
  });

  it('never returns undefined for an out-of-range index', () => {
    for (const stepIndex of [-1, 999]) {
      expect(stepLabel({ stepIndex, percent: 0, streamChars: 0 })).toBeTruthy();
    }
  });
});
