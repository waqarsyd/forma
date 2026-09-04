/**
 * The difference between "the user asked for something" and "the user asked for
 * nothing", kept as two different prompts instead of one with a fake value in it.
 *
 * ## What was wrong
 *
 * `App.tsx` substituted a sentence when the composer was empty —
 * `currentPrompt || "Generate a professional DevExpress report layout based on
 * these visuals."` — and the prompt then unconditionally emitted:
 *
 *     USER INSTRUCTIONS / CHAT REQUEST:
 *     "<that sentence>"
 *
 *     CRITICAL INSTRUCTION HANDLING:
 *     1. FIRST, build the complete base layout from the image(s).
 *     2. THEN, apply the USER INSTRUCTIONS as specific modifications.
 *
 * So on every attach-and-send with no typing, the model was handed an
 * instruction the user never gave and told to apply it as a *modification*.
 * Two things follow from that, and both are bad. The sentence restates the goal
 * in weaker words than the several hundred lines above it, and gemini.md's
 * standing rule is that a second, more concrete statement wins — here the
 * concrete one is the vaguest thing in the file. And step 2 asks for a diff
 * against a base layout when nothing was requested, which is an invitation to
 * invent a change.
 *
 * Observed on two live runs on 2026-09-04, both logging `Prompt: ""`: the same
 * source image produced a Detail band with twelve bound columns on one and no
 * Detail band at all on the other. An empty instruction is not a neutral input;
 * it is an ambiguous one, and this is one of the places the ambiguity came from.
 *
 * ## What replaces it
 *
 * Nothing is invented. With no instruction the block says there is none and
 * states the job plainly — reproduce the source. With an instruction it says so,
 * quotes it, and keeps the two-step ordering, which is correct precisely when
 * there IS something to apply on top of the base layout.
 */

export interface InstructionBlockOptions {
  /** True when the request carries a previous report to modify. */
  hasPreviousState?: boolean;
}

/**
 * The USER INSTRUCTIONS section of the generation prompt.
 *
 * Takes the raw composer text. Whitespace-only counts as empty: a stray space
 * must not flip the model into modification mode.
 */
export function instructionBlock(prompt: string | undefined | null, options: InstructionBlockOptions = {}): string {
  const text = (prompt ?? '').trim();
  const source = options.hasPreviousState ? 'the PREVIOUS REPORT STATE' : 'the attachment(s)';

  if (!text) {
    return `USER INSTRUCTIONS: NONE. The user attached the source and asked for nothing else.
          There is no request to interpret and nothing to change. Reproduce ${source} as faithfully as the rules above allow, and do NOT invent a modification, a styling preference, a title, or any content that is not in the source. If something in the source is ambiguous, follow the rules above rather than guessing at an intent the user did not express.`;
  }

  return `USER INSTRUCTIONS / CHAT REQUEST:
          "${text}"

          CRITICAL INSTRUCTION HANDLING:
          1. FIRST, build the complete, pixel-perfect base layout from ${source}.
          2. THEN, apply the USER INSTRUCTIONS as specific modifications (additions, deletions, style changes) to that base layout.
          3. NEVER discard the rest of the report structure just because the user asked for a specific change. The final output MUST contain the full report with the user's changes applied on top.`;
}
