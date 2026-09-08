/**
 * The review column's transcript, as data rather than as JSX.
 *
 * The chat is not a separate feature bolted onto the workspace — it *is* the
 * control surface for it. One composer does both jobs: the send button calls
 * `handleGenerate`, which answers conversationally when nothing is attached and
 * builds a report when something is. That decision, the history the model is
 * given, and the three ways a transcript is rewritten after the fact were all
 * inline in `App.tsx`, where nothing could reach them.
 *
 * Everything here is pure and takes the transcript as an argument, so the
 * question "what does the assistant actually see" has an answer a test can
 * assert. `App.tsx` keeps the state; this module keeps the rules.
 *
 * **Two deliberate non-dependencies.**
 *
 * `ChatMessage` is generic over its result type rather than importing
 * `DesignResult`, which lives in `App.tsx`. A `src/lib` module importing from
 * the component layer is the wrong direction — the same reasoning that keeps
 * `reportTypes.ts` down here — and `savedReport.ts` already solves it this way,
 * with `M` and `R` parameters it never needs to look inside.
 *
 * `ChatHistoryTurn` restates the shape of `ChatTurn` from `geminiService.ts`
 * rather than importing it, for the same reason in the other direction: `lib`
 * does not import `services`. The two are structurally identical, so the array
 * this builds is assignable to `ChatTurn[]` at the call site with no cast; if
 * that shape ever changes, the compiler says so there.
 */

/** A turn as the model receives it. Structurally `ChatTurn` in `geminiService`. */
export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * One entry in the review column.
 *
 * `R` is the generated-report type (`DesignResult` in the app) and `M` the
 * attachment metadata (`PreviewMeta`). Nothing here reads inside either; they
 * are carried so a message can own the result it produced and the provenance of
 * its images.
 *
 * `M` is a parameter rather than a structural minimum for a reason worth
 * keeping: the transcript passes `imageMeta` straight to `groupAttachments`,
 * which needs a real `PreviewMeta` — it groups by `uploadId`, precisely the
 * field a "good enough" inline shape would omit. Widening it here would compile
 * in this file and fail at the call site.
 */
export interface ChatMessage<R = unknown, M = unknown> {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: string[];
  /**
   * Provenance for `images`, so a sent message groups its attachments the same
   * way the composer did. Optional on purpose: reports saved before this existed
   * reload with images and no meta, and `groupAttachments` renders those one per
   * image rather than dropping them.
   */
  imageMeta?: M[];
  result?: R;
  /**
   * Set when the turn this message asked for failed. A failed chat turn used to
   * leave the user's message sitting in the transcript with no reply and no
   * marker, while the explanation appeared in a small note pinned under the
   * composer — two things that were never visually connected.
   */
  error?: string;
}

/**
 * A transcript id that cannot collide with the one before it.
 *
 * The five call sites used to be `Date.now().toString()`, with
 * `(Date.now() + 1).toString()` wherever two messages were created in the same
 * handler — a hack whose existence is the evidence that the collision was known
 * about. Two appends inside one millisecond produced the same id, and every
 * consumer degrades quietly when they do: React reconciles two rows onto one
 * key, `markMessageError` marks *both* matching messages rather than the one
 * that failed, and `truncateFrom` cuts at whichever came first.
 *
 * The timestamp is kept in front so ids still sort chronologically and old
 * saved reports — whose ids are bare timestamps — stay comparable. The counter
 * is per session, which is all that is needed: ids are React keys and retry
 * targets, never cross-referenced between reports.
 */
let messageSeq = 0;
export function nextMessageId(): string {
  messageSeq += 1;
  return `${Date.now()}-${messageSeq}`;
}

/**
 * Does this turn go to report generation rather than to a chat reply?
 *
 * An attachment — a page image, or text lifted out of a PDF or `.repx` — is an
 * unambiguous request to build something, so it skips the chat turn entirely.
 * Without one, the cheap chat call answers the message *and* reports whether a
 * report was being asked for, and only then does generation run.
 *
 * Taking two counts rather than the arrays keeps the caller free to pass
 * whatever it is holding, and makes the rule readable: any attachment at all.
 */
export function isGenerationTurn(previewCount: number, attachmentTextCount: number): boolean {
  return previewCount > 0 || attachmentTextCount > 0;
}

/**
 * The conversation as the model receives it: every prior turn, then the message
 * being sent.
 *
 * The new turn is appended here rather than by the caller because the caller
 * has already optimistically pushed it onto the transcript — building from
 * `messages` alone would send it twice, and building from `messages` *before*
 * the push would drop it. Passing it explicitly makes that ordering impossible
 * to get wrong.
 *
 * Note what is deliberately *not* filtered: a message carrying an `error`, and
 * the assistant's own "Generation stopped by user." line, both stay in the
 * history. They are things that genuinely happened in the conversation, and
 * hiding them produces a model that answers as though they had not.
 */
export function buildChatHistory(
  messages: ReadonlyArray<ChatHistoryTurn>,
  nextUserText: string
): ChatHistoryTurn[] {
  return [
    ...messages.map((m) => ({ role: m.role, text: m.text })),
    { role: 'user' as const, text: nextUserText },
  ];
}

/**
 * Attach a failure to the message that caused it.
 *
 * Returns the original array when nothing matches, so a retry racing a cleared
 * transcript is a no-op rather than an append.
 */
export function markMessageError<T extends { id: string; error?: string }>(
  messages: ReadonlyArray<T>,
  id: string,
  error: string
): T[] {
  return messages.map((m) => (m.id === id ? { ...m, error } : m));
}

/**
 * Drop a failed message and everything after it, ready for the turn to be sent
 * again.
 *
 * Without this a retry stacks a second copy of the same question underneath the
 * first. An unknown id returns the transcript untouched — the message may have
 * been cleared by **New report** between the click and the handler.
 */
export function truncateFrom<T extends { id: string }>(
  messages: ReadonlyArray<T>,
  id: string
): T[] {
  const idx = messages.findIndex((m) => m.id === id);
  return idx === -1 ? [...messages] : messages.slice(0, idx);
}

/**
 * The review column's own count, and the same wording on a saved project's row.
 *
 * Two call sites had this ternary written out; they are the kind that drift into
 * saying "1 notes" one release apart.
 */
export function noteCountLabel(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`;
}
