/**
 * The review column's transcript.
 *
 * Lifted out of `App.tsx` on 2026-09-08, after `lib/chatSession.ts` took the
 * rules. This is the markup half, and it is deliberately dumb: every piece of
 * state arrives as a prop and every action leaves as a callback, so the whole
 * thing can be rendered by a test without Firebase, pdf.js or a Gemini key
 * anywhere near it. That was the point — the transcript had no coverage at all,
 * which made it the riskiest thing in the file to move.
 *
 * **The container and `children` are load-bearing.** `.wb-thread` is the
 * scrolling column, and the generation progress card renders *inside* it, after
 * the transcript. That card is generation state, not conversation — the ring,
 * the pause and stop controls, the elapsed-time explanation — and pulling it in
 * here would mean ten props about a job this component has no other opinion
 * about. So it stays in `App.tsx` and arrives as `children`, which keeps the
 * emitted DOM identical to the version this replaced. If you render this
 * component without children, you get the transcript and nothing else, which is
 * exactly what the tests want.
 */

import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import PlanCard from './PlanCard';
import type { PreviewMeta } from '../lib/attachments';
import { messageMatches, messageTime, searchParts, type ChatMessage } from '../lib/chatSession';
import { formatSessionStamp } from '../lib/datetime';
import { copyText } from '../lib/clipboard';
import { scrollBehavior } from '../lib/motion';

/**
 * When a message was made (2026-11-05), quiet beside its icons: "Today,
 * 10:42", read off the id. What a reply cost in tokens stood beside it, from
 * a `usageOf` nothing passed since the owner's rule that no message names
 * machinery; it went on 2026-11-11 (the full audit's WS-38).
 */
function noteMeta(id: string): string {
  const at = messageTime(id);
  return at ? formatSessionStamp(at) : '';
}
import { IconArrowDown, IconCheck, IconCopy, IconRedo, IconThumbDown, IconThumbUp } from './landing/icons';

/* Loaded on demand, as the Spec pane loads it: react-markdown brings the whole
   micromark tokenizer, and the eager bundle is budgeted (see Markdown.tsx). */
const Markdown = lazy(() => import('./Markdown'));

/**
 * How far off the bottom still counts as "at the bottom".
 *
 * Zero would be correct and would break: `scrollTop` is fractional on a
 * trackpad or a zoomed page, so an exact comparison reads as scrolled-up
 * forever and the thread quietly stops following.
 */
const PIN_SLACK_PX = 40;

/** What a click on an attachment thumbnail asks the app to open. */
export interface AttachmentView {
  srcs: string[];
  index: number;
  file: string;
}

export interface ChatThreadProps<R> {
  messages: ReadonlyArray<ChatMessage<R, PreviewMeta>>;
  /** A chat turn is in flight; the placeholder shows what has streamed so far. */
  isChatting: boolean;
  /** A generation is in flight. Suppresses the chat placeholder — see below. */
  isAnalyzing: boolean;
  /** Text received so far this turn. Empty until the first token arrives. */
  streamingReply: string;
  /**
   * Answers to a message's clarifying questions (Prompt-to-Report in the
   * chat). Absent, the questions are drawn without a form.
   */
  onAnswer?: (id: string, answers: ClarifyAnswer[]) => void;
  /**
   * Under each of Forma's replies (2026-11-05), as ChatGPT has them: Copy,
   * always; a rating, which stays with the message; and Try again, which
   * sends the message the reply answered again. Absent, those two are not
   * offered.
   */
  onRegenerate?: (id: string) => void;
  onRate?: (id: string, rating: 'good' | 'bad' | undefined) => void;
  /**
   * The replies whose change to the report can still be taken back
   * (2026-11-05): the chat's edits and redesigns, while the report is still
   * the one that change left. Each gets an Undo.
   */
  undoable?: ReadonlySet<string>;
  onUndo?: (id: string) => void;
  /**
   * The replies whose change was taken back and can be made again
   * (2026-11-07): the report is still as the Undo left it. Each gets a Redo,
   * the same step as the corner's Redo.
   */
  redoable?: ReadonlySet<string>;
  onRedo?: (id: string) => void;
  /*
   * No proceed buttons (2026-11-11, the full audit's WS-09 and WS-38, the
   * owner's rule that a request is carried out at once): a reply's offered
   * export or designer (`onAction`), the Redesign / Not now of a redesign
   * asked about (`onConfirm`) and a plan's Start / Not now (`onPlan`) are
   * gone. A saved message that still carries one is drawn as its words.
   */
  /** Whether the Preview's rows may go with a question (2026-11-10): see `ChatMessage.consent`. The one question kept. */
  onConsent?: (id: string, yes: boolean) => void;
  /** The AI that designs, by name, for a plan's steps. */
  aiName?: string;
  /**
   * A turn under way between its steps (2026-11-11, the full audit's WS-19):
   * Try again and Undo wait for it as for a reply, or Try again cut the
   * thread and the turn under way refused to send it.
   */
  busy?: boolean;
  /**
   * A search of the requests: each match marked, nothing hidden. It hid the
   * replies that did not hold it until 2026-11-07 (agent audit item 30), and
   * a request the log found by its question showed "No message holds that",
   * the card being one request.
   */
  query?: string;
  /**
   * Whether a reply being written shows here (2026-11-05). The card shows a
   * request at a time, and an older one, read while a newer one runs, shows
   * its own replies and not the new one's dots. True when absent.
   */
  showWorking?: boolean;
  /** Forma's working line during a generation, rendered after the transcript. */
  children?: ReactNode;
  /**
   * The conversation as requests (2026-11-08), as Stitch's panel draws it
   * since it went back to a thread: each request a section, what was asked
   * pinned at its top while its replies scroll under it (`renderAsk`), and
   * Forma working in the newest. `messages` then holds every reply, for the
   * search count and the follow; absent, `messages` is drawn as one run of
   * replies, as the card of 2026-11-05 drew one request's.
   */
  turns?: ReadonlyArray<{ id: string; ask: ChatMessage<R, PreviewMeta> | null; replies: ReadonlyArray<ChatMessage<R, PreviewMeta>> }>;
  renderAsk?: (turn: { id: string; ask: ChatMessage<R, PreviewMeta> }) => ReactNode;
  /** The request picked to show what it changed, marked as the current one. */
  currentTurn?: string | null;
}

/** A message's text with every match of the search marked; the card's pill marks the words asked with it. */
export function Marked({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {searchParts(text, query).map((p, i) => (p.hit ? <mark key={i} className="wb-hit">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/**
 * What a message says (2026-11-05). Forma's words are Markdown, as ChatGPT's
 * and Gemini's replies are: a list, bold, `code` and a table draw as such
 * rather than as asterisks and pipes. The person's own words stay as typed,
 * line breaks kept, as those apps keep them. While a search is open both are
 * plain, so each match can be marked; and until the renderer has loaded, a
 * reply shows as plain text rather than as nothing.
 */
function MessageText({ text, query, markdown }: { text: string; query: string; markdown: boolean }) {
  const plain = (
    <p className="wb-plain">
      <Marked text={text} query={query} />
    </p>
  );
  if (!markdown || query.trim()) return plain;
  return (
    <div className="wb-md">
      <Suspense fallback={plain}>
        <Markdown>{text}</Markdown>
      </Suspense>
    </div>
  );
}

/** At most this often, a reply being written is drawn again (2026-11-11, PR-18). */
const STREAM_DRAW_MS = 100;

/**
 * A reply as it streams (2026-11-11, the full audit's PR-18). Each draw parses
 * the whole reply as Markdown, so a draw per chunk cost the square of its
 * length and long answers arrived unevenly. The text is taken at most every
 * STREAM_DRAW_MS, the last chunk always, and drawn at a lower priority than
 * typing, so the box stays quick while the reply is written.
 */
function StreamingText({ text, onDrawn }: { text: string; onDrawn: () => void }) {
  const [shown, setShown] = useState(text);
  const drawnAt = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => {
      drawnAt.current = Date.now();
      setShown(text);
    }, Math.max(0, STREAM_DRAW_MS - (Date.now() - drawnAt.current)));
    return () => clearTimeout(t);
  }, [text]);
  const drawn = useDeferredValue(shown);
  // The thread follows what is drawn, which now lags the text by a moment.
  useEffect(onDrawn, [drawn, onDrawn]);
  return <MessageText text={drawn} query="" markdown />;
}

/**
 * Copy, under a reply and on the person's message in the card's pill
 * (2026-11-05): the message's own words on the clipboard, "Copied" for a
 * moment. Through lib/clipboard.ts since 2026-11-07 (agent audit item 56),
 * as every other Copy in the workspace: it called the clipboard itself, so
 * on a plain-HTTP page, where the browser has none, it did nothing and said
 * nothing. The helper falls back to the older copy command there, and a
 * refusal says "Could not copy".
 */
export function CopyButton({ text }: { text: string }) {
  const [said, setSaid] = useState<'' | 'Copied' | 'Could not copy'>('');
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(''), 1600);
    return () => clearTimeout(t);
  }, [said]);
  const copy = async () => setSaid((await copyText(text)) ? 'Copied' : 'Could not copy');
  return (
    <button type="button" className="wb-note-act wb-note-icon" title={said || 'Copy'} aria-label={said || 'Copy'} onClick={() => void copy()}>
      {said === 'Copied' ? <IconCheck size={11} /> : <IconCopy size={13} />}
    </button>
  );
}

/**
 * Copy, the rating and Try again under one of Forma's replies (2026-11-05).
 * Quiet until the reply is pointed at, except on the latest, as ChatGPT
 * shows them. Copy says "Copied" for a moment; a clipboard the browser
 * refuses changes nothing. Rating the same way twice takes it back.
 */
function ReplyActions({
  id,
  text,
  rating,
  latest,
  disabled,
  undone,
  meta,
  onRegenerate,
  onRate,
  onUndo,
  onRedo,
}: {
  id: string;
  text: string;
  rating?: 'good' | 'bad';
  latest: boolean;
  disabled: boolean;
  /** Its time and cost, quiet at the end of the row. */
  meta?: string;
  /** Its change was taken back. */
  undone?: boolean;
  onRegenerate?: (id: string) => void;
  onRate?: (id: string, rating: 'good' | 'bad' | undefined) => void;
  /** Present only while its change can still be taken back. */
  onUndo?: (id: string) => void;
  /** Present only while its change, taken back, can be made again. */
  onRedo?: (id: string) => void;
}) {
  const rate = (value: 'good' | 'bad') => onRate?.(id, rating === value ? undefined : value);
  return (
    <div className={`wb-note-actions${latest ? '' : ' wb-note-actions--quiet'}`} role="group" aria-label="This reply">
      <CopyButton text={text} />
      {onRate && (
        <>
          <button type="button" className="wb-note-act wb-note-icon" title="Good reply" aria-label="Good reply" aria-pressed={rating === 'good'} onClick={() => rate('good')}>
            <IconThumbUp size={13} />
          </button>
          <button type="button" className="wb-note-act wb-note-icon" title="Bad reply" aria-label="Bad reply" aria-pressed={rating === 'bad'} onClick={() => rate('bad')}>
            <IconThumbDown size={13} />
          </button>
        </>
      )}
      {onRegenerate && (
        <button type="button" className="wb-note-act wb-note-icon" title="Try again" aria-label="Try again" disabled={disabled} onClick={() => onRegenerate(id)}>
          <IconRedo size={13} />
        </button>
      )}
      {onUndo && (
        <button type="button" className="wb-note-act" title="Put the report back as it was before this change" disabled={disabled} onClick={() => onUndo(id)}>
          Undo
        </button>
      )}
      {/* Made again by a Redo, the change is no longer undone, whatever the flag still says. */}
      {undone && !onUndo && <span className="wb-note-done">Undone</span>}
      {onRedo && !onUndo && (
        <button type="button" className="wb-note-act" title="Make this change again" disabled={disabled} onClick={() => onRedo(id)}>
          Redo
        </button>
      )}
      {meta && <span className="wb-note-meta">{meta}</span>}
    </div>
  );
}

/**
 * Editing a sent message, in place. Enter sends, Shift+Enter breaks the
 * line and Escape puts the message back, as in the composer.
 */
export function EditForm({ text, disabled, onSend, onCancel }: { text: string; disabled: boolean; onSend: (text: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(text);
  const changed = draft.trim().length > 0 && draft.trim() !== text.trim();
  return (
    <form
      className="wb-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) onSend(draft.trim());
      }}
    >
      <textarea
        className="wb-ctl"
        aria-label="Edit your message"
        value={draft}
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          // Not while an input method composes (2026-11-06): its Enter accepts
          // a candidate, and sent the edit early. The box already checked.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (changed && !disabled) onSend(draft.trim());
          }
        }}
      />
      <div className="wb-note-actions">
        <button type="submit" className="wb-pill wb-pill--accent" disabled={disabled || !changed}>
          Send
        </button>
        <button type="button" className="wb-pill wb-pill--outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Three dots that say Forma is working, and nothing else (2026-11-04). The
 * owner asked for the chat to look like the chat apps people know: the
 * attach button, the messages and the answers, with every step behind the
 * scenes. So no step names, percentages or timers are drawn in the thread;
 * the wrapper says what is happening to a screen reader.
 */
export function WorkingDots() {
  return (
    <span className="wb-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export interface ClarifyAnswer {
  id: string;
  question: string;
  answer: string;
}

/**
 * One note in the column, memoised on the message it draws.
 *
 * Measured 2026-09-08 before this existed: typing 22 characters into the
 * composer with six notes on screen re-rendered every note on every keystroke —
 * 264 note renders for one sentence, and each note holding images re-ran
 * `groupAttachments` each time. The transcript is a child of `App.tsx`, which
 * owns the composer's `prompt` state, so every keystroke re-rendered the lot.
 *
 * Messages are immutable — a new object only when something actually changes —
 * so identity is the right comparison and no custom comparator is needed.
 */
/**
 * A message's clarifying questions as a form: each a field holding its
 * suggested answer, so building with nothing typed accepts them all, as the
 * Describe dialog's questions did. Typing in the composer instead answers
 * them too; `App.tsx` reads that as a reply to the open questions.
 */
function ClarifyForm({
  id,
  questions,
  disabled,
  onAnswer,
}: {
  id: string;
  questions: NonNullable<ChatMessage['clarify']>['questions'];
  disabled: boolean;
  onAnswer: (id: string, answers: ClarifyAnswer[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(questions.map((q) => [q.id, q.suggestion ?? ''])));
  /*
   * One question at a time (2026-11-05), as Stitch's "Questions from Stitch"
   * card asks them: each with Forma's suggestion to keep or change, Next, and
   * Skip the rest, which keeps the suggestions for the rest; then, with more
   * than one, a summary to change any answer before building. `step` past
   * the last question is the summary.
   */
  const [step, setStep] = useState(0);
  const finish = () => onAnswer(id, questions.map((q) => ({ id: q.id, question: q.question, answer: (answers[q.id] ?? '').trim() })));
  const reviewing = step >= questions.length;
  const last = step === questions.length - 1;
  const single = questions.length === 1;
  const q = questions[Math.min(step, questions.length - 1)];
  /*
   * The keyboard's focus follows the step (2026-11-07, agent audit item 59):
   * Next, Skip the rest and Change swapped the field under it for another,
   * and focus fell to the top of the page. The next question's field takes
   * it, its words selected so typing replaces the suggestion; the summary's
   * Build the report takes it there. Not on the first draw, which would
   * pull focus from the box to a question nobody has looked at yet.
   */
  const fieldRef = useRef<HTMLInputElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  // The step last focused for, so a remount (React's strict mode runs effects twice) is not a move.
  const focusedStep = useRef(step);
  useEffect(() => {
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    if (reviewing) goRef.current?.focus();
    else {
      fieldRef.current?.focus();
      fieldRef.current?.select();
    }
  }, [step, reviewing]);
  return (
    <form
      className="wb-clarify"
      aria-label="Questions from Forma"
      onSubmit={(e) => {
        e.preventDefault();
        if (reviewing || single) finish();
        else setStep((s) => s + 1);
      }}
    >
      <div className="wb-clarify-head">
        <b>Questions from Forma</b>
        <span>{reviewing ? 'Summary' : `${step + 1} of ${questions.length}`}</span>
      </div>
      {reviewing ? (
        <ul className="wb-clarify-sum">
          {questions.map((x, i) => (
            <li key={x.id}>
              <span>{x.question}</span>
              <b>{answers[x.id]?.trim() || 'Forma decides'}</b>
              <button type="button" className="wb-note-act" disabled={disabled} onClick={() => setStep(i)}>
                Change
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <label key={q.id} className="wb-clarify-q">
          <span>{q.question}</span>
          <input
            ref={fieldRef}
            className="wb-ctl"
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers((all) => ({ ...all, [q.id]: e.target.value }))}
            disabled={disabled}
          />
        </label>
      )}
      <div className="wb-clarify-foot">
        {!reviewing && !single && !last && (
          <button type="button" className="wb-note-act" disabled={disabled} onClick={() => setStep(questions.length)}>
            Skip the rest
          </button>
        )}
        <button ref={goRef} type="submit" className="wb-pill wb-pill--go" disabled={disabled}>
          {reviewing || single ? 'Build the report' : last ? 'Review' : 'Next'}
        </button>
      </div>
    </form>
  );
}

const ChatNote = memo(function ChatNote<R>({
  message,
  retryDisabled,
  latest = false,
  onAnswer,
  onRegenerate,
  onRate,
  onUndo,
  onRedo,
  onConsent,
  aiName = 'the AI',
  query = '',
}: {
  message: ChatMessage<R, PreviewMeta>;
  retryDisabled: boolean;
  /** The latest of Forma's replies, whose actions show without pointing at it. */
  latest?: boolean;
  onConsent?: (id: string, yes: boolean) => void;
  aiName?: string;
  /** Present only while this reply's change can still be taken back. */
  onUndo?: (id: string) => void;
  /** Present only while this reply's change, taken back, can be made again. */
  onRedo?: (id: string) => void;
  onAnswer?: (id: string, answers: ClarifyAnswer[]) => void;
  onRegenerate?: (id: string) => void;
  onRate?: (id: string, rating: 'good' | 'bad' | undefined) => void;
  query?: string;
}) {
  /*
   * Forma's replies only. What the person asked, with its pictures, its
   * error and Try again, its Copy, Edit, Withdraw and versions, is the
   * pinned pill at the top of its request (ConversationPanel.tsx; the card's,
   * RequestCard.tsx, until 2026-11-08). This note drew the person's message too, with its
   * pictures and its error, until 2026-11-07 (agent audit item 61): the card
   * has passed the replies alone since the workspace audit, so none of that
   * was ever reached. `git log -S"wb-note--me"` finds it.
   */
  return (
    <article className="wb-note">
      <div>
        <div className="wb-who">Forma</div>
        {message.text && <MessageText text={message.text} query={query} markdown />}
        {message.clarify && !message.clarify.answered && onAnswer && (
          <ClarifyForm id={message.id} questions={message.clarify.questions} disabled={retryDisabled} onAnswer={onAnswer} />
        )}
        {/* A redesign asked about in an older thread is its words alone; a typed yes still answers it. */}
        {message.confirm?.answered === 'no' && <span className="wb-note-done">Not redesigned</span>}
        {message.plan && <PlanCard plan={message.plan} ai={aiName} />}
        {message.consent && !message.consent.answered && onConsent && (
          <div className="wb-note-actions" role="group" aria-label="Send the rows?">
            <button type="button" className="wb-pill wb-pill--accent" disabled={retryDisabled} onClick={() => onConsent(message.id, true)}>
              Send the rows
            </button>
            <button type="button" className="wb-pill wb-pill--outline" disabled={retryDisabled} onClick={() => onConsent(message.id, false)}>
              Answer without them
            </button>
          </div>
        )}
        {message.consent?.answered === 'no' && <span className="wb-note-done">Answered without the rows</span>}

        {message.text && (
          <ReplyActions
            id={message.id}
            text={message.text}
            rating={message.rating}
            latest={latest}
            disabled={retryDisabled}
            undone={message.undone}
            meta={noteMeta(message.id)}
            onRegenerate={onRegenerate}
            onRate={onRate}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        )}

      </div>
    </article>
  );
}) as <R>(props: {
  message: ChatMessage<R, PreviewMeta>;
  retryDisabled: boolean;
  latest?: boolean;
  onUndo?: (id: string) => void;
  onRedo?: (id: string) => void;
  onConsent?: (id: string, yes: boolean) => void;
  aiName?: string;
  onAnswer?: (id: string, answers: ClarifyAnswer[]) => void;
  onRegenerate?: (id: string) => void;
  onRate?: (id: string, rating: 'good' | 'bad' | undefined) => void;
  query?: string;
}) => React.ReactElement;

export default function ChatThread<R>({
  messages,
  isChatting,
  isAnalyzing,
  streamingReply,
  onAnswer,
  onRegenerate,
  onRate,
  undoable,
  onUndo,
  redoable,
  onRedo,
  onConsent,
  aiName,
  busy = false,
  query = '',
  showWorking = true,
  children,
  turns,
  renderAsk,
  currentTurn = null,
}: ChatThreadProps<R>) {
  /*
   * Stable dispatchers, so memoising `ChatNote` is not defeated by the callback
   * identities changing on every render of `App.tsx`.
   *
   * The tempting shortcut — a custom `memo` comparator that ignores the
   * functions — is a bug: the note would keep the *first* `onRetry` it was
   * given, whose closure holds the transcript as it was then, and a retry would
   * act on stale messages. Reading through a ref keeps the callbacks stable in
   * identity while always calling the current one.
   */
  const latest = useRef({ onAnswer, onRegenerate, onRate, onUndo, onRedo, onConsent });
  latest.current = { onAnswer, onRegenerate, onRate, onUndo, onRedo, onConsent };
  const consent = useCallback((id: string, yes: boolean) => latest.current.onConsent?.(id, yes), []);
  const undo = useCallback((id: string) => latest.current.onUndo?.(id), []);
  const redo = useCallback((id: string) => latest.current.onRedo?.(id), []);
  const answer = useCallback((id: string, answers: ClarifyAnswer[]) => latest.current.onAnswer?.(id, answers), []);
  const regenerate = useCallback((id: string) => latest.current.onRegenerate?.(id), []);
  const rate = useCallback((id: string, rating: 'good' | 'bad' | undefined) => latest.current.onRate?.(id, rating), []);

  const retryDisabled = isChatting || isAnalyzing || busy;
  const searching = query.trim().length > 0;
  // Marked, not filtered (agent audit item 30): the card is one request.
  const hits = searching ? messages.filter((m) => messageMatches(m, query)).length : 0;
  const lastReplyId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  /*
   * Follow the conversation, unless the reader has gone looking for something.
   *
   * `.wb-thread` is the scrolling element, so once the transcript outgrows the
   * column every reply lands below the fold and has to be scrolled to by hand.
   * That is how it behaved from the 2026-08-12 port until 2026-09-08: `App.tsx`
   * had kept a `messagesEndRef` and a `scrollIntoView` effect from the build
   * before it, but the port replaced the markup with the artifact's, which has
   * no sentinel div — so the ref attached to nothing and the effect ran against
   * `null` on every message for weeks. Reported from real use. Neither the type
   * checker nor the unused sweep can see it: the ref and the effect reference
   * each other, so both look live.
   *
   * `pinned` is what stops the fix becoming its own annoyance. Scrolling up to
   * re-read an earlier answer must not be undone by the next reply arriving, so
   * the position is recorded on every scroll and the follow only happens when
   * the reader was already at the bottom. The slack is because a fractional
   * `scrollTop` — a trackpad, a zoomed page — otherwise reads as "not quite at
   * the bottom" forever, and the thread silently stops following.
   */
  const threadRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /**
   * Whether the reader has scrolled away from the latest message, as state,
   * for the button that takes them back (2026-11-05), as ChatGPT and Gemini
   * show one. Set only when it changes, so scrolling does not re-render the
   * thread on every frame.
   */
  const [away, setAway] = useState(false);
  /** Until this time, the smooth scroll the button started is on its way down, and the button stays hidden. */
  const returningUntil = useRef(0);

  const notePinned = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_SLACK_PX;
    if (Date.now() < returningUntil.current && !pinned.current) return;
    setAway(!pinned.current);
  }, []);

  const toLatest = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    pinned.current = true;
    setAway(false);
    returningUntil.current = Date.now() + 1000;
    // Smooth unless the person asked their system for less motion (PR-19).
    el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() });
  }, []);

  const follow = useCallback(() => {
    const el = threadRef.current;
    if (!el || !pinned.current) return;
    // Assigned rather than `scrollTo({ behavior: 'smooth' })`: a streamed reply
    // updates many times a second, and successive smooth scrolls queue up and
    // lag behind the text they are meant to be following.
    el.scrollTop = el.scrollHeight;
  }, []);
  // `turns` too (2026-11-08): a message sent adds a request before any reply.
  useEffect(follow, [follow, messages, turns, streamingReply, isChatting, isAnalyzing]);

  const note = (msg: ChatMessage<R, PreviewMeta>) => (
    <ChatNote
      key={msg.id}
      message={msg}
      retryDisabled={retryDisabled}
      latest={msg.id === lastReplyId}
      onUndo={onUndo && undoable?.has(msg.id) ? undo : undefined}
      onRedo={onRedo && redoable?.has(msg.id) ? redo : undefined}
      onConsent={onConsent ? consent : undefined}
      aiName={aiName}
      onAnswer={onAnswer ? answer : undefined}
      // Not on a reply Forma wrote of its own accord: it answers no message (agent audit item 75).
      onRegenerate={onRegenerate && !msg.standalone ? regenerate : undefined}
      onRate={onRate ? rate : undefined}
      // Only a reply holding the words is drawn plain to mark them; the rest stay Markdown.
      query={searching && messageMatches(msg, query) ? query : ''}
    />
  );

  /* `!isAnalyzing` is not redundant. A message the assistant judges to be a
     real build request runs the chat turn *and then* falls through to
     generation, so both flags are briefly true; without this the thinking
     placeholder sits above the progress card claiming a second job.
     No live region of its own since 2026-11-07 (agent audit item 7): one
     mounted with its content is not announced, and a streamed reply in one
     is read a few words at a time. The panel's status region says when Forma
     starts and what it answered (ConversationPanel.tsx). */
  const working = (
    <>
      {showWorking && isChatting && !isAnalyzing && (
        <article className="wb-note">
          <div>
            <div className="wb-who">Forma</div>
            {/* The answer as it streams; until the first word, the dots. */}
            {streamingReply ? (
              <StreamingText text={streamingReply} onDrawn={follow} />
            ) : (
              <p className="wb-working">
                <WorkingDots />
                {/* The task, never its steps (2026-11-06), as Stitch names its own. */}
                <span className="wb-task">Working on it…</span>
              </p>
            )}
          </div>
        </article>
      )}
      {children}
    </>
  );

  return (
    <div className="wb-thread" ref={threadRef} onScroll={notePinned}>
      {/* An empty conversation is empty (2026-11-05). It opened with a note
          saying what the box takes and six predefined descriptions as chips,
          until the owner asked for all of that to go behind the scenes, as the
          chat apps people know do it; `git log -S"wb-note--start"` finds it. */}
      {searching && hits > 0 && (
        <p className="wb-search-count" role="status">
          {hits === 1 ? '1 reply holds that' : `${hits} replies hold that`}
        </p>
      )}
      {turns ? (
        <>
          {/* A section per request, what was asked pinned at its top while
              its replies scroll under it (2026-11-08). Forma working shows in
              the newest, so its pill stays pinned over the dots. */}
          {turns.map((turn, i) => (
            <section
              key={turn.id}
              className="wb-turn"
              data-turn={turn.id}
              aria-current={turn.id === currentTurn ? 'true' : undefined}
              aria-label={turn.ask ? undefined : 'From Forma'}
            >
              {turn.ask && renderAsk ? <div className="wb-turn-ask">{renderAsk({ id: turn.id, ask: turn.ask })}</div> : null}
              {turn.replies.map(note)}
              {i === turns.length - 1 ? working : null}
            </section>
          ))}
          {turns.length === 0 ? working : null}
        </>
      ) : (
        <>
          {messages.map(note)}
          {working}
        </>
      )}

      {/* Back to the latest message, while the reader is scrolled away from it
          (2026-11-05), as in ChatGPT and Gemini. Sticky at the foot of the
          scrolling column, so it stays over the conversation. */}
      {away && (
        <button type="button" className="wb-to-latest" title="Go to the latest message" aria-label="Go to the latest message" onClick={toLatest}>
          <IconArrowDown size={14} />
        </button>
      )}
    </div>
  );
}
