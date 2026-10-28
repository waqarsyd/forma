/**
 * Catching a model that has stopped writing a report and started repeating
 * itself.
 *
 * Found by the fidelity benchmark on 2026-10-28, the day it was built. A
 * twenty-row customer list, the simplest shape a DevExpress shop migrates,
 * completed one run in three on the auto-selected model. The failures were
 * not large designs: each ran about four minutes, hit the 65,536-token output
 * ceiling at 51,813 characters, and the last 120 characters received were all
 * `0`. A successful run of the same page is 5,400 characters of REPX and about
 * 5,500 output tokens. The model had written most of a correct response and
 * then fallen into a loop on a number, and nothing noticed until the ceiling
 * did -- at temperature 0 two of the failures were byte-identical in length,
 * which is a loop and not a coincidence.
 *
 * The cost of not noticing is the whole point. The stream kept the user, and
 * the benchmark, waiting four minutes for an answer that had been lost after
 * the first one, and then billed every token of the loop. With the detector in
 * the stream reader, the request is cut off within `RUNAWAY_WINDOW` characters
 * of the loop starting and retried, which turns a four-minute certain failure
 * into a one-minute probable success.
 *
 * What counts as a loop is deliberately narrow: the last `RUNAWAY_WINDOW`
 * characters are exactly periodic with a period of at most `RUNAWAY_MAX_PERIOD`.
 * A real report never does that. Repeated XML items differ in their `Ref`,
 * `Name` and coordinates, so they are never exactly periodic; indentation is a
 * handful of spaces, not hundreds; a number never has five hundred digits. The
 * things that are exactly periodic at that length are a stuck model's output
 * and nothing else, so a positive here is treated as certain and the stream is
 * aborted rather than merely flagged.
 */

export const RUNAWAY_WINDOW = 512;
export const RUNAWAY_MAX_PERIOD = 16;

export type RunawayVerdict =
  | { runaway: false }
  | { runaway: true; fragment: string; repeats: number };

/**
 * Is the tail of `text` a short fragment repeated to fill the window?
 *
 * Called once per streamed chunk, so it looks only at the last `window`
 * characters and at periods up to `maxPeriod`: at most a few thousand
 * comparisons, which is nothing beside the chunk that arrived. Below the window
 * there is not enough text to judge and the answer is no.
 */
export function detectRunaway(
  text: string,
  window: number = RUNAWAY_WINDOW,
  maxPeriod: number = RUNAWAY_MAX_PERIOD,
): RunawayVerdict {
  if (text.length < window) return { runaway: false };
  const tail = text.slice(-window);
  for (let period = 1; period <= maxPeriod; period++) {
    let periodic = true;
    for (let i = period; i < tail.length; i++) {
      if (tail.charCodeAt(i) !== tail.charCodeAt(i - period)) {
        periodic = false;
        break;
      }
    }
    if (periodic) {
      return { runaway: true, fragment: tail.slice(0, period), repeats: Math.floor(window / period) };
    }
  }
  return { runaway: false };
}

/**
 * Thrown by a stream reader that cut a looping model off.
 *
 * Its `name` is what the retry loop in `analyzeReportDesign` keys on, so it
 * survives being wrapped the way the SDK's own errors are. It is never shown
 * to the user as-is: once the retries are spent the service composes a message
 * that says what to do, and this one only has to say what happened.
 */
export class RunawayOutputError extends Error {
  readonly chars: number;
  readonly fragment: string;
  readonly repeats: number;

  constructor(chars: number, fragment: string, repeats: number) {
    super(
      `The model stopped writing the report and began repeating ${JSON.stringify(fragment)} -- ` +
        `${repeats} times in a row after ${chars} characters.`,
    );
    this.name = 'RunawayOutputError';
    this.chars = chars;
    this.fragment = fragment;
    this.repeats = repeats;
  }
}

export function isRunawayOutput(error: unknown): error is RunawayOutputError {
  return (error as { name?: unknown } | null)?.name === 'RunawayOutputError';
}
