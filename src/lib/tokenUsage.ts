/**
 * What one generation cost, in the form the status bar shows it.
 *
 * ## Why this is in the UI at all
 *
 * The numbers were already measured -- `geminiService.ts` reads `usageMetadata`
 * off the final stream chunks and has logged them since streaming was added. But
 * a `console.log` is not a readout: seeing it means opening devtools, knowing
 * the line exists, and generating again if the console was cleared.
 *
 * That gap had a cost. Three separate attempts were made to check the token
 * usage of a change that had just been made to reduce it, and none of them could
 * -- offline mock runs return before the API call, so the line never appears.
 * The measurement existed and was unreachable, which is the same as not having
 * it. It goes beside the band count and the REPX audit chip, which are the other
 * two things that describe the artifact rather than the app.
 *
 * ## Why the parts are shown and not just the total
 *
 * They behave differently and are worked on differently. Input is the prompt,
 * and it is the one this project can shrink by asking for less -- see
 * `promptSections.ts`. Output is what the model wrote, and it tracks how much
 * report there is. Thinking is billed like output and produces nothing visible,
 * so a large number there is a signal to reach for `thinkingBudget` and nothing
 * else. A single total hides all three.
 */

/** The fields of Gemini's `usageMetadata` this app has any use for. */
export interface TokenUsage {
  input: number;
  output: number;
  /** Reasoning tokens: billed and timed like output, invisible in the result. */
  thinking: number;
  total: number;
}

/**
 * Read the SDK's usage metadata into our own shape.
 *
 * Every field is optional on the way in and the SDK has renamed them before, so
 * a missing count reads as 0 rather than as `NaN` propagating into the bar. Null
 * comes back when there is nothing worth showing at all, which is the mock path
 * and any response that arrived without metadata.
 */
export function readTokenUsage(
  metadata:
    | {
        promptTokenCount?: number | null;
        candidatesTokenCount?: number | null;
        thoughtsTokenCount?: number | null;
        totalTokenCount?: number | null;
      }
    | null
    | undefined,
): TokenUsage | null {
  if (!metadata) return null;
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const input = n(metadata.promptTokenCount);
  const output = n(metadata.candidatesTokenCount);
  const thinking = n(metadata.thoughtsTokenCount);
  // Prefer the reported total: Google counts it, and it has not always been the
  // simple sum of the parts. Fall back to the sum when it is absent.
  const total = n(metadata.totalTokenCount) || input + output + thinking;

  if (!input && !output && !total) return null;
  return { input, output, thinking, total };
}

/**
 * A count short enough for a status bar: `847`, `12.9k`, `1.4M`.
 *
 * One decimal place from a thousand up, because the difference between 12.9k and
 * 13.4k is the size of a prompt section and worth seeing, while the difference
 * between 12,914 and 12,937 is noise that makes the bar jitter.
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** The status bar's own text: the total, because the bar has room for one number. */
export function summariseUsage(usage: TokenUsage | null | undefined): string | null {
  if (!usage) return null;
  return `${formatTokenCount(usage.total)} tokens`;
}

/**
 * The tooltip, where the parts go.
 *
 * Thinking is listed only when it happened. It is zero on every model this app
 * currently selects, and a permanent `thinking 0` teaches the reader to ignore
 * the line that would matter most if it ever stopped being zero.
 */
export function describeUsage(usage: TokenUsage | null | undefined): string | null {
  if (!usage) return null;
  const parts = [
    `Input ${usage.input.toLocaleString()} (the prompt and your attachments)`,
    `Output ${usage.output.toLocaleString()} (the spec, the mockup and the REPX)`,
  ];
  if (usage.thinking > 0) {
    parts.push(
      `Thinking ${usage.thinking.toLocaleString()} (billed like output, produces nothing visible)`,
    );
  }
  parts.push(`Total ${usage.total.toLocaleString()}`);
  return parts.join('\n');
}
