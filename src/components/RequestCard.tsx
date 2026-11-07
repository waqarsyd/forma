/**
 * The conversation a request at a time, floating over the report (2026-11-05).
 *
 * The owner found the chat-app column did not fit Forma and asked for Google
 * Stitch's workspace instead, measured in their own signed-in Stitch that
 * evening: the canvas fills the window, and the agent's card floats at its top
 * left, showing one request, with the person's prompt pinned in a pill at the
 * top and the reply under it, and a mark that collapses the card to itself.
 * Every request is in the log beneath it (`RequestLog.tsx`); the box is a bar
 * of its own at the foot of the canvas. See *The conversation floats over the
 * report* in docs/notes/app-shell.md.
 *
 * The replies are drawn by `ChatThread`, so every reply keeps what it had:
 * Markdown, Copy, the rating, Try again, Undo, the questions and the redesign
 * buttons. What the person asked is drawn here, as the pill, with its own
 * Copy, Edit, Withdraw, versions and pictures behind the arrow; the thread's
 * own copy of those went in the workspace audit (2026-11-06).
 */
import { useState } from 'react';
import ChatThread, { CopyButton, EditForm, Marked, type AttachmentView, type ChatThreadProps } from './ChatThread';
import { groupAttachments, groupLabel, type PreviewMeta } from '../lib/attachments';
import { messageTime, requestTitle, type ChatMessage, type ChatRequest } from '../lib/chatSession';
import { formatSessionStamp } from '../lib/datetime';
import { IconChevronDown, IconPencil, IconTrash } from './landing/icons';

export interface RequestCardProps<R> extends Omit<ChatThreadProps<R>, 'messages' | 'showWorking'> {
  /** The request shown, or null before the first message. */
  request: ChatRequest<R, PreviewMeta> | null;
  /** It is the newest: only there does a reply being written, or Forma working, show. */
  latest: boolean;
  /** Folded to its mark, as Stitch's card folds. */
  collapsed: boolean;
  onToggle: () => void;
  /** The person's initials, for the pill; "Y", for you, signed out. */
  initials?: string;
  /**
   * The pill's own: an edit sends the changed text again from that message
   * on, as Try again does; a withdrawal takes the message and Forma's answers
   * to it out of the transcript; a version is another the message had (see
   * `ChatMessage.branches`). Only the pill offers them since 2026-11-06.
   */
  onEdit?: (id: string, text: string) => void;
  onWithdraw?: (id: string) => void;
  onShowVersion?: (id: string, to: number) => void;
  /** The pill's Try again, on a request that failed; the thread's own went with its dead branches (agent audit item 61). */
  onRetry: (id: string) => void;
  /** A picture sent with the request, opened in the viewer. */
  onOpenAttachment: (view: AttachmentView) => void;
}

/** What the person asked, pinned at the top of the card. */
function AskPill<R>({
  ask,
  initials,
  disabled,
  onEdit,
  onWithdraw,
  onShowVersion,
  onOpenAttachment,
  onRetry,
  query,
}: {
  ask: ChatMessage<R, PreviewMeta>;
  initials: string;
  disabled: boolean;
  onEdit?: (id: string, text: string) => void;
  onWithdraw?: (id: string) => void;
  onShowVersion?: (id: string, to: number) => void;
  onOpenAttachment: (view: AttachmentView) => void;
  onRetry: (id: string) => void;
  /** The log's search, marked in the words asked as in the replies (agent audit item 30). */
  query: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const title = requestTitle({ id: ask.id, ask, replies: [] });
  const versions = ask.branches && ask.branches.length > 1 && ask.branch !== undefined ? { at: ask.branch, of: ask.branches.length } : null;
  const pictures = ask.images?.length ?? 0;
  const sent = messageTime(ask.id);
  return (
    <div className={`wb-ask${open ? ' wb-is-open' : ''}`}>
      <div className="wb-ask-line">
        <span className="wb-ask-av" aria-hidden="true">{initials}</span>
        {editing ? (
          <EditForm
            text={ask.text}
            disabled={disabled}
            onSend={(text) => {
              setEditing(false);
              onEdit?.(ask.id, text);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <p className="wb-ask-text" title={open ? undefined : ask.text || title}>
            <Marked text={open && ask.text ? ask.text : title} query={query} />
            {!open && pictures > 0 && ask.text && <span className="wb-ask-count"> · {pictures} {pictures === 1 ? 'picture' : 'pictures'}</span>}
          </p>
        )}
        {!editing && (
          <button
            type="button"
            className="wb-note-act wb-note-icon wb-ask-more"
            aria-expanded={open}
            title={open ? 'Show less' : pictures ? 'Show the whole message and its pictures' : 'Show the whole message'}
            aria-label={open ? 'Show less' : pictures ? 'Show the whole message and its pictures' : 'Show the whole message'}
            onClick={() => setOpen((o) => !o)}
          >
            <IconChevronDown size={13} />
          </button>
        )}
      </div>
      {/*
        * When it was sent, its versions, Copy, Edit and Withdraw, in a row of
        * their own under the words (2026-11-07, agent audit items 61 and 65),
        * as ChatGPT has them under a message: the versions, Edit and Withdraw
        * were behind the arrow, where nobody looked for them, and the time
        * was nowhere.
        */}
      {!editing && (withdrawing ? (
        <div className="wb-note-actions wb-ask-foot" role="group" aria-label="Withdraw this message">
          <span className="wb-note-ask">Withdraw this message and Forma's answer?</span>
          <button
            type="button"
            className="wb-note-act wb-danger"
            disabled={disabled}
            onClick={() => {
              setWithdrawing(false);
              onWithdraw?.(ask.id);
            }}
          >
            Withdraw
          </button>
          <button type="button" className="wb-note-act" onClick={() => setWithdrawing(false)}>
            Keep
          </button>
        </div>
      ) : (
        <div className="wb-note-actions wb-ask-foot" role="group" aria-label="Your message">
          {sent ? <span className="wb-note-meta">{formatSessionStamp(sent)}</span> : null}
          {versions && onShowVersion && (
            <div className="wb-versions" role="group" aria-label="Versions of this message">
              <button type="button" aria-label="Previous version" disabled={disabled || versions.at === 0} onClick={() => onShowVersion(ask.id, versions.at - 1)}>
                <IconChevronDown size={12} />
              </button>
              <span>{versions.at + 1}/{versions.of}</span>
              <button type="button" aria-label="Next version" disabled={disabled || versions.at === versions.of - 1} onClick={() => onShowVersion(ask.id, versions.at + 1)}>
                <IconChevronDown size={12} />
              </button>
            </div>
          )}
          <span className="wb-ask-foot-gap" />
          {ask.text && <CopyButton text={ask.text} />}
          {onEdit && ask.text && (
            <button type="button" className="wb-note-act wb-note-icon" title="Edit" aria-label="Edit" disabled={disabled} onClick={() => setEditing(true)}>
              <IconPencil size={13} />
            </button>
          )}
          {onWithdraw && (
            <button type="button" className="wb-note-act wb-note-icon" title="Withdraw this message and Forma's answer" aria-label="Withdraw" disabled={disabled} onClick={() => setWithdrawing(true)}>
              <IconTrash size={13} />
            </button>
          )}
        </div>
      ))}
      {open && !editing && pictures > 0 && (
        <div className="wb-ask-extra">
          <div className="wb-attach-strip">
            {groupAttachments(ask.imageMeta ?? [], pictures).map((group) => {
              const label = groupLabel(group);
              const srcs = group.indices.map((i) => ask.images![i]);
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
        </div>
      )}
      {/* A turn that failed carries its error on the message that asked it. */}
      {ask.error && (
        <p role="alert" className="wb-ask-error">
          {ask.error}{' '}
          <button className="wb-pill wb-pill--outline" onClick={() => onRetry(ask.id)} disabled={disabled}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}

export default function RequestCard<R>({
  request,
  latest,
  collapsed,
  onToggle,
  initials = 'Y',
  isChatting,
  isAnalyzing,
  onEdit,
  onWithdraw,
  onShowVersion,
  onOpenAttachment,
  onRetry,
  children,
  ...thread
}: RequestCardProps<R>) {
  return (
    <section
      className={`wb-reply${collapsed ? ' wb-is-collapsed' : ''}${latest && (isChatting || isAnalyzing) ? ' wb-is-working' : ''}`}
      aria-label="Forma's reply"
    >
      {/* Stitch's two-dot mark: it folds the card to itself and opens it again. */}
      <button
        type="button"
        className="wb-reply-mark"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Show the reply' : 'Fold the reply away'}
        title={collapsed ? 'Show the reply' : 'Fold the reply away'}
        onClick={onToggle}
      >
        <i />
        <i />
      </button>
      {/* Folded, the card hides what it holds rather than dropping it
          (2026-11-07, agent audit item 32): answers typed into Forma's
          questions and an edit of the message were lost on a fold. */}
      <div className="wb-reply-body" hidden={collapsed}>
          {request?.ask && (
            <AskPill
              key={request.id}
              ask={request.ask}
              initials={initials}
              disabled={isChatting || isAnalyzing}
              onEdit={onEdit}
              onWithdraw={onWithdraw}
              onShowVersion={onShowVersion}
              onOpenAttachment={onOpenAttachment}
              onRetry={onRetry}
              query={thread.query ?? ''}
            />
          )}
          {/* One thread per request (2026-11-06): its scroll state, the
              "go to latest" arrow and whether it follows the latest, carried
              over to another request picked in the log. */}
          <ChatThread
            key={`thread-${request?.id ?? 'none'}`}
            {...thread}
            messages={request?.replies ?? []}
            isChatting={isChatting}
            isAnalyzing={isAnalyzing}
            showWorking={latest}
            // A request Forma started, as a project opening on its own report,
            // has no message to send again (agent audit item 75).
            onRegenerate={request?.ask ? thread.onRegenerate : undefined}
          >
            {latest ? children : null}
          </ChatThread>
      </div>
    </section>
  );
}
