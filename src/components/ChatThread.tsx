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

import type { ReactNode } from 'react';
import { groupAttachments, groupLabel, type PreviewMeta } from '../lib/attachments';
import type { ChatMessage } from '../lib/chatSession';

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

export default function ChatThread<R>({
  messages,
  isChatting,
  isAnalyzing,
  streamingReply,
  onRetry,
  onOpenAttachment,
  children,
}: ChatThreadProps<R>) {
  return (
    <div className="wb-thread">
      {messages.map((msg) => (
        <article key={msg.id} className={`wb-note${msg.role === 'user' ? ' wb-note--me' : ''}`}>
          <span className="wb-spine" />
          <div>
            <div className="wb-who">{msg.role === 'user' ? 'You' : 'Forma'}</div>
            {msg.text && <p>{msg.text}</p>}

            {msg.images && msg.images.length > 0 && (
              // Sent messages showed a count and nothing else, so once a
              // message was on the transcript there was no way to check
              // what had gone with it. Names are not kept on a message —
              // `ChatMessage.images` is data URLs only, and a saved report
              // reloads with just those — so the picture is the label.
              <div className="wb-attach-strip">
                {groupAttachments(msg.imageMeta ?? [], msg.images.length).map((group) => {
                  const label = groupLabel(group);
                  const srcs = group.indices.map((i) => msg.images![i]);
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
            {msg.error && (
              <p role="alert" style={{ color: 'var(--bad-ink)' }}>
                {msg.error}{' '}
                <button
                  className="wb-pill wb-pill--outline"
                  onClick={() => onRetry(msg.id)}
                  disabled={isChatting || isAnalyzing}
                >
                  Try again
                </button>
              </p>
            )}
          </div>
        </article>
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
