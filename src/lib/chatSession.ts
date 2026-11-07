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
  /**
   * Questions the assistant asks before designing a report from a typed
   * description (Prompt-to-Report in the chat, 2026-11-01), each with a
   * suggested answer the thread draws as a field to keep or change. `answered`
   * once the reader has replied, by the form or by typing.
   */
  clarify?: { questions: { id: string; question: string; suggestion?: string }[]; answered: boolean };
  /**
   * The person's rating of one of Forma's replies (2026-11-05), as ChatGPT's
   * thumbs. Kept with the message, and so with a saved project, and sent
   * nowhere.
   */
  rating?: 'good' | 'bad';
  /** The change this reply made was taken back with its Undo (2026-11-05). */
  undone?: true;
  /**
   * Sent with no report open (2026-11-07). Try again and an edit design it
   * from nothing again, after a reload too, rather than refining the report
   * the first answer built; the report itself is not kept on the message.
   */
  fresh?: true;
  /**
   * Written by Forma of its own accord, not in answer to the message before
   * it (2026-11-07): a report built from the OCR review. Try again has nothing
   * to send again, so it is not offered.
   */
  standalone?: true;
  /**
   * A redesign this reply asks before making (2026-11-05): with a report
   * open, a change only a full redesign can make costs a minute or two and
   * the whole REPX in tokens, so Forma asks first, as an agent asks before a
   * costly step. `prompt` is what is redesigned from; `answered` once the
   * person has said yes or no, by the buttons or by typing.
   */
  confirm?: { prompt: string; answered?: 'yes' | 'no' };
  /**
   * The versions of one of the person's messages (2026-11-05), as ChatGPT
   * keeps them: an edit, or Try again on the reply, sends the message again
   * and keeps the one it replaced, with everything that followed it, so
   * "‹ 1/2 ›" can go back. `branch` is the version showing; its entry in
   * `branches` is refreshed from the live transcript whenever it is left.
   */
  branches?: ChatBranch<R, M>[];
  branch?: number;
}

/** One version of a message: its words, its pictures, and the conversation that followed it. */
export interface ChatBranch<R = unknown, M = unknown> {
  text: string;
  images?: string[];
  imageMeta?: M[];
  tail: ChatMessage<R, M>[];
}

/**
 * The versions a message sent again carries: every earlier one, the one
 * being replaced as it stands with what followed it, and a place for the new
 * one, which is showing. `text` is the new words.
 */
export function branchesForResend<R, M>(messages: ReadonlyArray<ChatMessage<R, M>>, at: number, text: string): { branches: ChatBranch<R, M>[]; branch: number } {
  const old = messages[at];
  const live: ChatBranch<R, M> = { text: old.text, images: old.images, imageMeta: old.imageMeta, tail: messages.slice(at + 1) };
  const prior = old.branches?.length ? old.branches.map((b, i) => (i === old.branch ? live : b)) : [live];
  return { branches: [...prior, { text, images: old.images, imageMeta: old.imageMeta, tail: [] }], branch: prior.length };
}

/**
 * Show another version of the message at `at`: the version showing is kept
 * as it now stands, with what followed it, and the chosen one's words,
 * pictures and conversation take its place. The report is not touched, as
 * withdrawing does not touch it: the versions are of the conversation, and
 * the reports each made are in Revisions. Unknown versions change nothing.
 */
export function showBranch<R, M>(messages: ReadonlyArray<ChatMessage<R, M>>, at: number, to: number): ChatMessage<R, M>[] {
  const m = messages[at];
  if (!m?.branches || m.branch === undefined || to === m.branch || !m.branches[to]) return [...messages];
  const live: ChatBranch<R, M> = { text: m.text, images: m.images, imageMeta: m.imageMeta, tail: messages.slice(at + 1) };
  const branches = m.branches.map((b, i) => (i === m.branch ? live : b));
  const target = branches[to];
  const shown: ChatMessage<R, M> = { ...m, text: target.text, images: target.images, imageMeta: target.imageMeta, branches, branch: to };
  return [...messages.slice(0, at), shown, ...target.tail];
}

/** A typed yes to a question Forma asked: "yes", "ok", "go ahead", "do it", "redesign it". */
export const AFFIRMATIVE = /^\s*(yes|yeah|yep|ok(ay)?|sure|go( ahead)?|do it|please( do)?|redesign( it)?)\b[\s.!]*$/i;

/**
 * The person's message a reply answers: the nearest one before it. Null for
 * a reply with none before it, or an id that is not one of Forma's replies.
 * Try again on a reply (2026-11-05) sends that message again.
 */
export function answeredBy<T extends { id: string; role: 'user' | 'assistant' }>(messages: ReadonlyArray<T>, replyId: string): T | null {
  const at = messages.findIndex((m) => m.id === replyId);
  if (at === -1 || messages[at].role !== 'assistant') return null;
  for (let i = at - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i];
  return null;
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
 * When a message was made, read off its id (2026-11-05): `nextMessageId`
 * puts the time first, and saved reports from before it used the bare time,
 * so every message has one without a field of its own. Null for an id that
 * does not start with a plausible time.
 */
export function messageTime(id: string): number | null {
  const ms = Number(/^\d{12,13}/.exec(id)?.[0]);
  return ms > 1e12 && ms < 4102444800000 ? ms : null;
}

/**
 * The conversation as a Markdown file (2026-11-05), for the Chat column's
 * Export: the report's name, then each message under who said it and when,
 * Forma's replies as written (they are Markdown already), the person's
 * words as a quote, so a heading or a list typed in a message stays text.
 * Pictures are counted, not embedded: a file of base64 helps nobody read.
 */
export function conversationMarkdown(
  messages: ReadonlyArray<{ id: string; role: 'user' | 'assistant'; text: string; images?: string[] }>,
  title: string,
  when: (ms: number) => string = (ms) => new Date(ms).toLocaleString(),
): string {
  const parts = [`# ${title.trim() || 'Forma conversation'}`, ''];
  for (const m of messages) {
    const at = messageTime(m.id);
    parts.push(`**${m.role === 'user' ? 'You' : 'Forma'}**${at ? ` · ${when(at)}` : ''}`, '');
    if (m.role === 'user') {
      if (m.text.trim()) parts.push(m.text.split('\n').map((line) => `> ${line}`).join('\n'));
    } else if (m.text.trim()) parts.push(m.text.trim());
    if (m.images?.length) parts.push(`_(${m.images.length} ${m.images.length === 1 ? 'picture' : 'pictures'} attached)_`);
    parts.push('');
  }
  return `${parts.join('\n').trimEnd()}\n`;
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
  messages: ReadonlyArray<ChatHistoryTurn & { clarify?: { questions: { question: string; suggestion?: string }[] } }>,
  nextUserText: string
): ChatHistoryTurn[] {
  return [
    // Forma's questions are in the form, not the words (2026-11-07, agent
    // audit item 87): without them the model saw "Before I design it, two
    // questions" and never what they were, so a typed answer meant nothing.
    ...messages.map((m) => ({
      role: m.role,
      text: m.clarify?.questions.length
        ? `${m.text}\n${m.clarify.questions.map((q, i) => `${i + 1}. ${q.question}${q.suggestion ? ` (suggested: ${q.suggestion})` : ''}`).join('\n')}`
        : m.text,
    })),
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
 * A failure marked on the request that failed (2026-11-07): the message
 * `askId` names, or the person's latest when it is unknown or gone. Until
 * then a failed generation or description only set the banner, and the log
 * listed the request as answered with no Try again. A transcript with no
 * message of the person's comes back as it was.
 */
export function markAskError<T extends { id: string; role: 'user' | 'assistant'; error?: string }>(
  messages: ReadonlyArray<T>,
  error: string,
  askId?: string,
): T[] {
  const named = askId !== undefined && messages.some((m) => m.id === askId && m.role === 'user');
  const id = named ? askId : [...messages].reverse().find((m) => m.role === 'user')?.id;
  return id === undefined ? [...messages] : markMessageError(messages, id, error);
}

/** What a request left unanswered by a closed or reloaded page says. */
export const INTERRUPTED = 'Forma had not answered when the page was left.';

/**
 * A saved conversation whose last message is the person's, with no answer
 * and no error, was left mid-turn (2026-11-07): it is saved as soon as it is
 * sent, and the answer never came. Marked, so the request offers Try again
 * rather than reading as answered.
 */
export function markInterrupted<T extends { id: string; role: 'user' | 'assistant'; error?: string }>(messages: ReadonlyArray<T>): T[] {
  const last = messages[messages.length - 1];
  return last && last.role === 'user' && !last.error ? markMessageError(messages, last.id, INTERRUPTED) : [...messages];
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
 * Withdraw one of the person's own messages (2026-11-04): the message and
 * Forma's answers to it, up to the person's next message, leave the
 * transcript, and so leave the history the next turn sends. A report the
 * turn built stays where it is; the Revisions panel keeps it like any other.
 * An unknown id, or one of Forma's messages, changes nothing.
 */
export function withdrawTurn<T extends { id: string; role: 'user' | 'assistant' }>(messages: ReadonlyArray<T>, id: string): T[] {
  const idx = messages.findIndex((m) => m.id === id);
  if (idx === -1 || messages[idx].role !== 'user') return [...messages];
  let end = idx + 1;
  while (end < messages.length && messages[end].role !== 'user') end++;
  return [...messages.slice(0, idx), ...messages.slice(end)];
}

/** A search for `query` as typed, matching case-insensitively; null when there is nothing to look for. */
function searchPattern(query: string): RegExp | null {
  const q = query.trim();
  return q ? new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'giu') : null;
}

/**
 * `text` cut where `query` occurs, each piece saying whether it is a match,
 * for the transcript search to mark. Split on the pattern rather than on
 * indexes into a lower-cased copy, because lower-casing can change a
 * string's length ("İ" becomes two code units) and the cuts would drift.
 */
export function searchParts(text: string, query: string): { text: string; hit: boolean }[] {
  const pattern = searchPattern(query);
  if (!pattern) return [{ text, hit: false }];
  return text
    .split(pattern)
    .map((piece, i) => ({ text: piece, hit: i % 2 === 1 }))
    .filter((p) => p.text.length > 0);
}

/** Whether a message holds `query`, in its text or in the questions it asks. */
export function messageMatches(message: { text: string; clarify?: { questions: { question: string }[] } }, query: string): boolean {
  const pattern = searchPattern(query);
  if (!pattern) return true;
  const test = (s: string) => {
    pattern.lastIndex = 0;
    return pattern.test(s);
  };
  return test(message.text) || (message.clarify?.questions.some((q) => test(q.question)) ?? false);
}

/**
 * Whether a saved project holds `query`, in its name or anywhere in its chat:
 * the sidebar's Search (2026-11-05), which searches the projects as ChatGPT's
 * searches its chats. Every project matches an empty query.
 */
export function projectMatches(project: { name: string; messages: readonly { text: string; clarify?: { questions: { question: string }[] } }[] }, query: string): boolean {
  const pattern = searchPattern(query);
  if (!pattern) return true;
  pattern.lastIndex = 0;
  return pattern.test(project.name) || project.messages.some((m) => messageMatches(m, query));
}

/**
 * One request: what the person asked and Forma's answers to it, up to their
 * next message (2026-11-05). The conversation is shown a request at a time,
 * as Google Stitch's agent card shows it, with every request in a log
 * beneath it; see *The conversation floats over the report* in app-shell.md.
 * Its id is the asking message's, or the first reply's when Forma spoke
 * first, as it does when a saved project opens on its own report.
 */
export interface ChatRequest<R = unknown, M = unknown> {
  id: string;
  ask: ChatMessage<R, M> | null;
  replies: ChatMessage<R, M>[];
}

/** The transcript as requests, oldest first. Every message lands in exactly one. */
export function requestsOf<R, M>(messages: ReadonlyArray<ChatMessage<R, M>>): ChatRequest<R, M>[] {
  const requests: ChatRequest<R, M>[] = [];
  for (const m of messages) {
    if (m.role === 'user') requests.push({ id: m.id, ask: m, replies: [] });
    else if (requests.length === 0) requests.push({ id: m.id, ask: null, replies: [m] });
    else requests[requests.length - 1].replies.push(m);
  }
  return requests;
}

/**
 * A request's line in the log: the first line of what was asked, the
 * pictures it sent when it said nothing, or "Forma" when nobody asked.
 */
export function requestTitle(request: ChatRequest): string {
  const ask = request.ask;
  if (!ask) return 'Forma';
  const line = ask.text.split('\n').find((l) => l.trim())?.trim();
  if (line) return line;
  const pictures = ask.images?.length ?? 0;
  return pictures ? `${pictures} ${pictures === 1 ? 'picture' : 'pictures'}` : 'Your message';
}

/**
 * Where a request stands, for its mark in the log: failed, waiting on the
 * person (questions or a redesign to confirm), or answered.
 */
export function requestState(request: ChatRequest): 'failed' | 'waiting' | 'done' {
  const all = [request.ask, ...request.replies].filter(Boolean) as ChatMessage[];
  if (all.some((m) => m.error)) return 'failed';
  if (request.replies.some((m) => (m.clarify && !m.clarify.answered) || (m.confirm && !m.confirm.answered))) return 'waiting';
  return 'done';
}

/** Whether a request holds `query` in anything it says, for the log's search. */
export function requestMatches(request: ChatRequest, query: string): boolean {
  return [request.ask, ...request.replies].some((m) => !!m && messageMatches(m, query));
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
