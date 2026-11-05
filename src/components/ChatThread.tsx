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

import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { groupAttachments, groupLabel, type PreviewMeta } from '../lib/attachments';
import { messageMatches, searchParts, type ChatMessage } from '../lib/chatSession';
import { IconCheck, IconCopy, IconRedo, IconThumbDown, IconThumbUp } from './landing/icons';

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
  onRetry: (id: string) => void;
  onOpenAttachment: (view: AttachmentView) => void;
  /**
   * Answers to a message's clarifying questions (Prompt-to-Report in the
   * chat). Absent, the questions are drawn without a form.
   */
  onAnswer?: (id: string, answers: ClarifyAnswer[]) => void;
  /**
   * The person's own messages can be edited and withdrawn (2026-11-04). An
   * edit sends the changed text again from that message on, as Try again
   * does; a withdrawal takes the message and Forma's answers to it out of
   * the transcript. Absent, neither is offered.
   */
  onEdit?: (id: string, text: string) => void;
  onWithdraw?: (id: string) => void;
  /**
   * Under each of Forma's replies (2026-11-05), as ChatGPT has them: Copy,
   * always; a rating, which stays with the message; and Try again, which
   * sends the message the reply answered again. Absent, those two are not
   * offered.
   */
  onRegenerate?: (id: string) => void;
  onRate?: (id: string, rating: 'good' | 'bad' | undefined) => void;
  /** A transcript search: only the messages holding it are drawn, with each match marked. */
  query?: string;
  /** Forma's working line during a generation, rendered after the transcript. */
  children?: ReactNode;
}

/** A message's text with every match of the search marked. */
function Marked({ text, query }: { text: string; query: string }) {
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
  onRegenerate,
  onRate,
}: {
  id: string;
  text: string;
  rating?: 'good' | 'bad';
  latest: boolean;
  disabled: boolean;
  onRegenerate?: (id: string) => void;
  onRate?: (id: string, rating: 'good' | 'bad' | undefined) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* no clipboard here (an insecure page, a refusal): nothing to say */
    }
  };
  const rate = (value: 'good' | 'bad') => onRate?.(id, rating === value ? undefined : value);
  return (
    <div className={`wb-note-actions${latest ? '' : ' wb-note-actions--quiet'}`} role="group" aria-label="This reply">
      <button type="button" className="wb-note-act wb-note-icon" title={copied ? 'Copied' : 'Copy'} aria-label={copied ? 'Copied' : 'Copy'} onClick={() => void copy()}>
        {copied ? <IconCheck size={11} /> : <IconCopy size={13} />}
      </button>
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
    </div>
  );
}

/**
 * Editing a sent message, in place. Enter sends, Shift+Enter breaks the
 * line and Escape puts the message back, as in the composer.
 */
function EditForm({ text, disabled, onSend, onCancel }: { text: string; disabled: boolean; onSend: (text: string) => void; onCancel: () => void }) {
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
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && !e.shiftKey) {
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
  return (
    <form
      className="wb-clarify"
      onSubmit={(e) => {
        e.preventDefault();
        onAnswer(id, questions.map((q) => ({ id: q.id, question: q.question, answer: (answers[q.id] ?? '').trim() })));
      }}
    >
      {questions.map((q) => (
        <label key={q.id} className="wb-clarify-q">
          <span>{q.question}</span>
          <input
            className="wb-ctl"
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers((all) => ({ ...all, [q.id]: e.target.value }))}
            disabled={disabled}
          />
        </label>
      ))}
      <button type="submit" className="wb-pill wb-pill--accent" disabled={disabled}>
        Build the report
      </button>
    </form>
  );
}

const ChatNote = memo(function ChatNote<R>({
  message,
  retryDisabled,
  latest = false,
  onRetry,
  onOpenAttachment,
  onAnswer,
  onEdit,
  onWithdraw,
  onRegenerate,
  onRate,
  query = '',
}: {
  message: ChatMessage<R, PreviewMeta>;
  retryDisabled: boolean;
  /** The latest of Forma's replies, whose actions show without pointing at it. */
  latest?: boolean;
  onRetry: (id: string) => void;
  onOpenAttachment: (view: AttachmentView) => void;
  onAnswer?: (id: string, answers: ClarifyAnswer[]) => void;
  onEdit?: (id: string, text: string) => void;
  onWithdraw?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onRate?: (id: string, rating: 'good' | 'bad' | undefined) => void;
  query?: string;
}) {
  const mine = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // A message sent with pictures is not offered for editing: an edit sends
  // the text again, and the pictures would not go with it.
  const editable = mine && !!onEdit && !!message.text && !message.images?.length;
  return (
    <article className={`wb-note${mine ? ' wb-note--me' : ''}`}>
      <span className="wb-spine" />
      <div>
        <div className="wb-who">{mine ? 'You' : 'Forma'}</div>
        {editing ? (
          <EditForm
            text={message.text}
            disabled={retryDisabled}
            onSend={(text) => {
              setEditing(false);
              onEdit?.(message.id, text);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          message.text && <MessageText text={message.text} query={query} markdown={!mine} />
        )}
        {message.clarify && !message.clarify.answered && onAnswer && (
          <ClarifyForm id={message.id} questions={message.clarify.questions} disabled={retryDisabled} onAnswer={onAnswer} />
        )}

        {message.images && message.images.length > 0 && (
          // Sent messages showed a count and nothing else, so once a
          // message was on the transcript there was no way to check
          // what had gone with it. Names are not kept on a message —
          // `ChatMessage.images` is data URLs only, and a saved report
          // reloads with just those — so the picture is the label.
          <div className="wb-attach-strip">
            {groupAttachments(message.imageMeta ?? [], message.images.length).map((group) => {
              const label = groupLabel(group);
              const srcs = group.indices.map((i) => message.images![i]);
              return (
                <button
                  key={`${group.file}-${group.indices[0]}`}
                  type="button"
                  className="wb-attach-shot"
                  onClick={() => onOpenAttachment({ srcs, index: 0, file: group.file })}
                  title={`View ${label}`}
                  aria-label={`View ${label}`}
                >
                  <img src={srcs[0]} alt="" />
                  {group.pages > 1 && <span className="wb-attach-pages">{group.pages}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* The failure belongs beside the turn that failed. */}
        {message.error && (
          <p role="alert" style={{ color: 'var(--bad-ink)' }}>
            {message.error}{' '}
            <button
              className="wb-pill wb-pill--outline"
              onClick={() => onRetry(message.id)}
              disabled={retryDisabled}
            >
              Try again
            </button>
          </p>
        )}

        {!mine && message.text && (
          <ReplyActions
            id={message.id}
            text={message.text}
            rating={message.rating}
            latest={latest}
            disabled={retryDisabled}
            onRegenerate={onRegenerate}
            onRate={onRate}
          />
        )}

        {mine && !editing && (editable || onWithdraw) && (
          withdrawing ? (
            <div className="wb-note-actions" role="group" aria-label="Withdraw this message">
              <span className="wb-note-ask">Withdraw this message and Forma's answer?</span>
              <button
                type="button"
                className="wb-note-act wb-danger"
                disabled={retryDisabled}
                onClick={() => {
                  setWithdrawing(false);
                  onWithdraw?.(message.id);
                }}
              >
                Withdraw
              </button>
              <button type="button" className="wb-note-act" onClick={() => setWithdrawing(false)}>
                Keep
              </button>
            </div>
          ) : (
            <div className="wb-note-actions wb-note-actions--quiet">
              {editable && (
                <button type="button" className="wb-note-act" disabled={retryDisabled} onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {onWithdraw && (
                <button type="button" className="wb-note-act" disabled={retryDisabled} onClick={() => setWithdrawing(true)}>
                  Withdraw
                </button>
              )}
            </div>
          )
        )}
      </div>
    </article>
  );
}) as <R>(props: {
  message: ChatMessage<R, PreviewMeta>;
  retryDisabled: boolean;
  latest?: boolean;
  onRetry: (id: string) => void;
  onOpenAttachment: (view: AttachmentView) => void;
  onAnswer?: (id: string, answers: ClarifyAnswer[]) => void;
  onEdit?: (id: string, text: string) => void;
  onWithdraw?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onRate?: (id: string, rating: 'good' | 'bad' | undefined) => void;
  query?: string;
}) => React.ReactElement;

export default function ChatThread<R>({
  messages,
  isChatting,
  isAnalyzing,
  streamingReply,
  onRetry,
  onOpenAttachment,
  onAnswer,
  onEdit,
  onWithdraw,
  onRegenerate,
  onRate,
  query = '',
  children,
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
  const latest = useRef({ onRetry, onOpenAttachment, onAnswer, onEdit, onWithdraw, onRegenerate, onRate });
  latest.current = { onRetry, onOpenAttachment, onAnswer, onEdit, onWithdraw, onRegenerate, onRate };
  const retry = useCallback((id: string) => latest.current.onRetry(id), []);
  const openAttachment = useCallback(
    (view: AttachmentView) => latest.current.onOpenAttachment(view),
    []
  );
  const answer = useCallback((id: string, answers: ClarifyAnswer[]) => latest.current.onAnswer?.(id, answers), []);
  const edit = useCallback((id: string, text: string) => latest.current.onEdit?.(id, text), []);
  const withdraw = useCallback((id: string) => latest.current.onWithdraw?.(id), []);
  const regenerate = useCallback((id: string) => latest.current.onRegenerate?.(id), []);
  const rate = useCallback((id: string, rating: 'good' | 'bad' | undefined) => latest.current.onRate?.(id, rating), []);

  const retryDisabled = isChatting || isAnalyzing;
  const searching = query.trim().length > 0;
  const shown = searching ? messages.filter((m) => messageMatches(m, query)) : messages;
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

  const notePinned = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_SLACK_PX;
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (!el || !pinned.current) return;
    // Assigned rather than `scrollTo({ behavior: 'smooth' })`: a streamed reply
    // updates many times a second, and successive smooth scrolls queue up and
    // lag behind the text they are meant to be following.
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingReply, isChatting, isAnalyzing]);

  return (
    <div className="wb-thread" ref={threadRef} onScroll={notePinned}>
      {/* An empty conversation is empty (2026-11-05). It opened with a note
          saying what the box takes and six predefined descriptions as chips,
          until the owner asked for all of that to go behind the scenes, as the
          chat apps people know do it; `git log -S"wb-note--start"` finds it. */}
      {searching && (
        <p className="wb-search-count" role="status">
          {shown.length === 0
            ? 'No message holds that.'
            : `${shown.length} of ${messages.length} ${messages.length === 1 ? 'message' : 'messages'}`}
        </p>
      )}
      {shown.map((msg) => (
        <ChatNote
          key={msg.id}
          message={msg}
          retryDisabled={retryDisabled}
          latest={msg.id === lastReplyId}
          onRetry={retry}
          onOpenAttachment={openAttachment}
          onAnswer={onAnswer ? answer : undefined}
          onEdit={onEdit ? edit : undefined}
          onWithdraw={onWithdraw ? withdraw : undefined}
          onRegenerate={onRegenerate ? regenerate : undefined}
          onRate={onRate ? rate : undefined}
          query={searching ? query : ''}
        />
      ))}

      {/* `!isAnalyzing` is not redundant. A message the assistant judges to be a
          real build request runs the chat turn *and then* falls through to
          generation, so both flags are briefly true; without this the thinking
          placeholder sits above the progress card claiming a second job. */}
      {isChatting && !isAnalyzing && (
        <article className="wb-note" aria-live="polite">
          <span className="wb-spine" />
          <div>
            <div className="wb-who">Forma</div>
            {/* The answer as it streams; until the first word, the dots. */}
            {streamingReply ? (
              <MessageText text={streamingReply} query="" markdown />
            ) : (
              <p role="status" aria-label="Forma is working">
                <WorkingDots />
              </p>
            )}
          </div>
        </article>
      )}

      {children}
    </div>
  );
}
