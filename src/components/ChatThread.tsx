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

import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { groupAttachments, groupLabel, type PreviewMeta } from '../lib/attachments';
import type { ChatMessage } from '../lib/chatSession';

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
  /** The generation progress card, rendered after the transcript. */
  children?: ReactNode;
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
const ChatNote = memo(function ChatNote<R>({
  message,
  retryDisabled,
  onRetry,
  onOpenAttachment,
}: {
  message: ChatMessage<R, PreviewMeta>;
  retryDisabled: boolean;
  onRetry: (id: string) => void;
  onOpenAttachment: (view: AttachmentView) => void;
}) {
  return (
    <article className={`wb-note${message.role === 'user' ? ' wb-note--me' : ''}`}>
      <span className="wb-spine" />
      <div>
        <div className="wb-who">{message.role === 'user' ? 'You' : 'Forma'}</div>
        {message.text && <p>{message.text}</p>}

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
      </div>
    </article>
  );
}) as <R>(props: {
  message: ChatMessage<R, PreviewMeta>;
  retryDisabled: boolean;
  onRetry: (id: string) => void;
  onOpenAttachment: (view: AttachmentView) => void;
}) => React.ReactElement;

export default function ChatThread<R>({
  messages,
  isChatting,
  isAnalyzing,
  streamingReply,
  onRetry,
  onOpenAttachment,
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
  const latest = useRef({ onRetry, onOpenAttachment });
  latest.current = { onRetry, onOpenAttachment };
  const retry = useCallback((id: string) => latest.current.onRetry(id), []);
  const openAttachment = useCallback(
    (view: AttachmentView) => latest.current.onOpenAttachment(view),
    []
  );

  const retryDisabled = isChatting || isAnalyzing;

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
      {messages.map((msg) => (
        <ChatNote
          key={msg.id}
          message={msg}
          retryDisabled={retryDisabled}
          onRetry={retry}
          onOpenAttachment={openAttachment}
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
            <p>{streamingReply || 'Thinking…'}</p>
          </div>
        </article>
      )}

      {children}
    </div>
  );
}
