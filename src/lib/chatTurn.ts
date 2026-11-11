/**
 * How the chat box routes a message before any AI is asked (2026-11-07, the
 * agent audit's batch B): what is kept as a memory, what goes straight to a
 * design, and what a reply typed while Forma's questions wait is. Pure and
 * small, so App.tsx imports it on the first render and the rules are tested
 * here rather than only by using the app.
 */

/**
 * A message that asks Forma to remember something, rather than to design
 * (the owner's rule, 2026-11-07): it starts "remember" or "from now on".
 * Until then it also took "always", "never", "note that", "I prefer" and "by
 * default", so "Never mind, make the title red" was kept as a memory and told
 * to every report after it; those words now go to the agent, which acts on
 * them for this report. One copy: App.tsx had its own, which had already
 * drifted from this one (agent audit items 2 and 92).
 */
export const REMEMBER = /^\s*(please\s+)?(remember(\s+that)?|from now on)\b[\s:,-]*/i;

/** Whether a message is one to keep as a memory: REMEMBER, and not a question. */
export function isRememberMessage(text: string): boolean {
  return REMEMBER.test(text) && !/\?\s*$/.test(text);
}

/** "Create / build / make … a … report" and its kin: a report asked for in so many words. */
const PLAIN_BUILD = /^\s*(please\s+)?(create|build|make|design|generate|produce|draft|prepare)\s+(me\s+)?(a|an|the|my|our)?\s*([\p{L}\p{N} ]{0,40}?)\b(report|list|register|invoice|statement|ledger|summary|payslips?|labels?|catalogue)\b(.*)$/isu;
/** Nouns that name a report without saying what it shows. */
const VAGUE_NOUNS = new Set(['report', 'list', 'summary']);
/** Words that say nothing about a report's content. */
const EMPTY_WORDS = new Set([
  'new', 'simple', 'basic', 'nice', 'good', 'quick', 'sample', 'test', 'small', 'short', 'one', 'another', 'proper', 'professional',
  'please', 'for', 'me', 'us', 'of', 'with', 'that', 'which', 'the', 'a', 'an', 'and', 'to', 'in', 'on', 'now', 'today', 'it', 'thanks',
]);

/**
 * A report asked for in words with something to design from (agent audit item
 * 80): "create a sales report", "make an invoice", "build a report of orders
 * by region". Such a message skips the chat turn, which would only say it is
 * a report request. "Create a report" or "make a new list" says nothing of
 * what it shows, so it goes to the chat, which asks; it went straight to a
 * design until 2026-11-07.
 */
export function isPlainBuild(text: string, isLanguage?: (word: string) => boolean): boolean {
  // "Generate the report in German" with nothing open names no report (see `isVagueReportAsk`).
  if (isVagueReportAsk(text, isLanguage)) return false;
  const m = PLAIN_BUILD.exec(text);
  if (!m) return false;
  const noun = m[6].toLowerCase().replace(/s$/, '');
  if (!VAGUE_NOUNS.has(noun)) return true;
  const said = `${m[5]} ${m[7]}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return said.some((w) => !EMPTY_WORDS.has(w));
}

/**
 * "Generate the report in German", "make my report as a PDF": a report named
 * only as "the", "this" or "my" report, with nothing but a language or a
 * format said of it (2026-11-11, the full audit's CV-14). With nothing open
 * and nothing attached there is no report it can mean, and it went to a
 * design from those words alone. Forma asks which, the one question it asks
 * because nothing can be started.
 *
 * Only a language or a format (the review of CV-14, 2026-11-11): "create the
 * report as an invoice" or "make the report as a payslip" says what to design,
 * and asking "Which report?" of it broke the rule that a request is carried
 * out. The language is the caller's to name (`isLanguage`, from
 * `repxTranslate.languageAsked`), because the language table lives in a lazy
 * module and this one is in the workspace's own chunk; with none given, only
 * a format counts.
 */
const VAGUE_REPORT = /^\s*(please\s+)?((can|could|would) you\s+)?(create|build|make|design|generate|produce|draft|prepare|give me|send me|i need|i want|put|do|translate|convert|export)?\s*(me\s+)?(the|this|that|my|our)\s+report\s+(in|into|as|to)\s+(an?\s+)?(?<word>[\p{L}.-]+)(\s+(please|file|format|language|now))?\s*[.!]?\s*$/iu;
/** The formats a report is exported as, in the words a person uses for them. */
const FORMAT_WORDS = new Set(['pdf', 'excel', 'xlsx', 'csv', 'word', 'docx', 'rtf', 'html', 'png', 'picture', 'image', 'spreadsheet', 'workbook', 'repx']);

/** The one word said of "the report" in a vague ask's shape ("German" of "generate the report in German"), or null. */
export function vagueReportWord(text: string): string | null {
  return VAGUE_REPORT.exec(text)?.groups?.word ?? null;
}

export function isVagueReportAsk(text: string, isLanguage: (word: string) => boolean = () => false): boolean {
  const word = vagueReportWord(text);
  if (!word) return false;
  return FORMAT_WORDS.has(word.toLowerCase().replace(/^\./, '')) || isLanguage(word);
}

/** What Forma asks of a vague report ask: which report, in the language it named when it named one. */
export function vagueReportReply(language?: string | null): string {
  return `Which report? Attach a picture or a PDF of it, or tell me what it should list, and I'll make it${language ? ` in ${language}` : ''}.`;
}

/**
 * Whether a question about the data waits on the person's say before the
 * Preview's rows go (2026-11-11, the full audit's WS-01 and CV-03): asked
 * once per project, never again once answered either way. `resend` is the
 * question sent again with the answer, which the state has not caught up
 * with yet; a no sends it without the rows, never asks it twice.
 */
export function needsRowsConsent(decision: 'yes' | 'no' | null, resend?: { consented?: boolean; declined?: boolean }): boolean {
  return decision === null && !resend?.consented && !resend?.declined;
}

/**
 * What an answer with nothing in it says, the report turn's and the plain
 * chat's (2026-11-11, the full audit's CV-26): a person's words, where "Sorry —
 * I did not catch that." was an apology in a form nobody says.
 */
export const NOT_FOLLOWED = "I didn't follow that. Could you say it another way?";

/** What a report was made from, for the first reply about it. */
export type ReplyKind = 'open' | 'picture' | 'pdf' | 'repx' | 'description';

/**
 * Forma's first reply about a report it made (2026-11-11, the full audit's
 * UI2, CV-13 and PL-24): what happened, in words, and never the person's own
 * request said back. "I've updated the report from your instructions" was
 * said of a first report built from a picture and "Make this report in German".
 */
export function firstReply(kind: ReplyKind, hasWords: boolean, language?: string | null, bilingual?: boolean): string {
  if (kind === 'open') return "Done. I've changed the report as you asked.";
  // Asked for in two languages (CP-06): said as the chat's translation says it.
  const both = language && bilingual ? `, with ${language} beside its own language. Switch between them in the Preview` : '';
  if (kind === 'description') return `Here's the report you described${both || (language ? `, in ${language}` : '')}.`;
  // A .repx is already a report (2026-11-11, the full audit's UI11): "the
  // report from your report" said the same word twice and meant nothing.
  if (kind === 'repx') return `Here's your report again${both || (language ? `, in ${language}` : hasWords ? ', with what you asked for' : '')}.`;
  const from = kind === 'pdf' ? 'your PDF' : 'your page';
  if (language) return `Here's the report from ${from}${both || `, in ${language}`}.`;
  return hasWords ? `Here's the report from ${from}, with what you asked for.` : `Here's the report from ${from}.`;
}

/**
 * What a message typed while Forma's questions wait is (agent audit item 87):
 * an answer to them, a new request (they are dropped and it is routed as any
 * message is), or a question of its own, which the chat answers while the
 * questions stay open. Until 2026-11-07 every typed message was the answer.
 */
export function pendingReplyKind(text: string): 'answer' | 'new' | 'question' {
  if (isPlainBuild(text)) return 'new';
  if (/\?\s*$/.test(text) && !/^\s*(yes|no|ok|sure)\b/i.test(text)) return 'question';
  return 'answer';
}

/*
 * The turn's control flow, out of App.tsx (2026-11-07, agent audit item 36):
 * the queue's next step, Steer and Resume, the questions a turn waits on, the
 * report a message sent again starts from, and how a turn that ended is said
 * in a hidden tab's title. Each was written inline in App, where nothing
 * tested it, and three of them had been wrong there before (items 3, 24, 28).
 * Generic over the message, so App's own types pass through unchanged.
 */

/** What these rules read of a message. */
export interface TurnMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  error?: string;
  images?: string[];
  imageMeta?: unknown[];
  fresh?: true;
  result?: unknown;
  clarify?: { answered: boolean; request?: unknown };
  confirm?: { answered?: 'yes' | 'no' };
}

/** What these rules read of a queued message. */
export interface TurnQueued {
  id: string;
  text: string;
  steer?: true;
  steerFrom?: string;
  go?: true;
  images?: string[];
  imageMeta?: unknown[];
}

/**
 * The queue's next step once Forma is free (items 27 and 28): nothing when it
 * is empty; a pause when Forma asked something, or the last request failed,
 * and the next message was queued before that was known; otherwise the next
 * message and what is left. A steer, or one Resume released, goes anyway:
 * the person said so.
 */
export function queueStep<Q extends TurnQueued>(queue: readonly Q[], messages: readonly TurnMessage[]): { send: Q; rest: Q[] } | 'pause' | null {
  if (!queue.length) return null;
  const [next, ...rest] = queue;
  const last = messages[messages.length - 1];
  const asking = last?.role === 'assistant' && ((last.clarify && !last.clarify.answered) || (last.confirm && !last.confirm.answered));
  const failed = [...messages].reverse().find((m) => m.role === 'user')?.error;
  if (!next.steer && !next.go && (asking || failed)) return 'pause';
  return { send: next, rest };
}

/** Resume (item 27): the next message goes whatever is waiting. */
export function resumed<Q extends TurnQueued>(queue: readonly Q[]): Q[] {
  return queue.length ? [{ ...queue[0], go: true }, ...queue.slice(1)] : [...queue];
}

/**
 * Steer (item 86): the queued message goes next, carrying the words of the
 * request it changes, and its pictures when it had some. Unchanged when the
 * message is no longer queued.
 */
export function steered<Q extends TurnQueued>(queue: readonly Q[], id: string, messages: readonly TurnMessage[]): Q[] {
  const item = queue.find((x) => x.id === id);
  if (!item) return [...queue];
  const working = [...messages].reverse().find((m) => m.role === 'user');
  const steer: Q = {
    ...item,
    steer: true,
    ...(working?.text ? { steerFrom: working.text } : {}),
    ...(working?.images?.length ? { images: working.images, imageMeta: working.imageMeta } : {}),
  };
  return [steer, ...queue.filter((x) => x.id !== id)];
}

/**
 * The questions the conversation waits on (item 24): Forma's last message,
 * when it asked and has not been answered, with the description it asked
 * about, which it carries so they can be answered after a reload.
 */
export function pendingQuestions<R>(messages: readonly TurnMessage[]): { request: R; messageId: string } | null {
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' && last.clarify && !last.clarify.answered && last.clarify.request
    ? { request: last.clarify.request as R, messageId: last.id }
    : null;
}

/**
 * The report a message sent again starts from (item 3): the one it found when
 * first sent, kept this session (`bases`); none, for a message that started a
 * project of its own (`fresh`); otherwise the report before the first change
 * a reply to it made (`changes`); undefined, the report as it is now, when it
 * made none.
 */
export function turnBase<R>(
  ask: TurnMessage,
  messages: readonly TurnMessage[],
  bases: ReadonlyMap<string, R | null>,
  changes: Readonly<Record<string, { before: R } | undefined>>,
): R | null | undefined {
  if (bases.has(ask.id)) return bases.get(ask.id) ?? null;
  if (ask.fresh) return null;
  const at = messages.indexOf(ask);
  if (at === -1) return undefined;
  for (const m of messages.slice(at + 1)) {
    if (m.role === 'user') break;
    const change = changes[m.id];
    if (change) return change.before;
  }
  return undefined;
}

/**
 * How a turn that ended is said in a hidden tab's title (item 63): a failure,
 * a question waiting, a report made or changed, or a reply. Reads the newest
 * request: its ask and the replies after it.
 */
export function turnEnding(
  request: { ask?: TurnMessage | null; replies: readonly TurnMessage[] },
  changes: Readonly<Record<string, unknown>>,
): 'Request failed' | 'Question waiting' | 'Report ready' | 'Reply ready' {
  if ([request.ask, ...request.replies].some((m) => m?.error)) return 'Request failed';
  if (request.replies.some((m) => (m.clarify && !m.clarify.answered) || (m.confirm && !m.confirm.answered))) return 'Question waiting';
  return request.replies.some((m) => m.result || changes[m.id]) ? 'Report ready' : 'Reply ready';
}

/**
 * The selection on the Preview as words for a redesign (agent audit item 19):
 * the chat turn sees it in the outline, and a redesign the turn hands on did
 * not, so "make these a table" redesigned the whole report blind to "these".
 */
export function withSelection(words: string, selected: readonly string[]): string {
  if (!selected.length) return words;
  return `${words}\n\nThe user has these controls selected on the Preview, and "this", "these" or "them" mean them: ${selected.join(', ')}.`;
}
