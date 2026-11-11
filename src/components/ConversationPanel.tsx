/**
 * The conversation, a thread in a panel down the left of the report
 * (2026-11-08), as Google Stitch's workspace has it since it changed.
 *
 * On 2026-11-05 the owner chose Stitch's layout of the day: a card at the top
 * left showing one request at a time, a log of every request beneath it, and
 * the box a bar of its own at the foot. On 2026-11-08 Stitch had moved on, and
 * the owner asked to follow: one full-height panel on the left, every request
 * in one scrolling thread with what was asked pinned at the top of its section
 * while its replies scroll under it, and the box at the panel's foot. Folding
 * the panel folds the box with it, to one mark, as Stitch's does. The log went:
 * its search and its download are the panel's header now, and a request that
 * changed the report offers to show what it changed on the Preview. See *The
 * conversation is a thread in a panel* in docs/notes/app-shell.md.
 *
 * The replies are drawn by `ChatThread`, so every reply keeps what it had:
 * Markdown, Copy, the rating, Try again, Undo, the questions and the redesign
 * buttons. What the person asked is drawn here, as the pill, with its own
 * Copy, Edit, Withdraw, versions and pictures behind the arrow. This file was
 * RequestCard.tsx until then; `git log --follow` reads its history.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import ChatThread, { CopyButton, EditForm, Marked, type AttachmentView, type ChatThreadProps } from './ChatThread';
import { groupAttachments, groupLabel, type PreviewMeta } from '../lib/attachments';
import { messageTime, requestAnnouncement, requestTitle, type ChatMessage, type ChatRequest } from '../lib/chatSession';
import { formatSessionStamp } from '../lib/datetime';
import ErrorBoundary from './ErrorBoundary';
import { IconChevronDown, IconCollapse, IconDownload, IconExpand, IconEye, IconPencil, IconSearch, IconTrash } from './landing/icons';

export interface ConversationPanelProps<R> extends Omit<ChatThreadProps<R>, 'messages' | 'showWorking' | 'turns' | 'renderAsk' | 'currentTurn'> {
  /** Every request, oldest first (`requestsOf`). */
  requests: ReadonlyArray<ChatRequest<R, PreviewMeta>>;
  /** Folded to its mark, the box with it, as Stitch's panel folds. */
  collapsed: boolean;
  onToggle: () => void;
  /** The person's initials, for the pill; "Y", for you, signed out. */
  initials?: string;
  /**
   * The pill's own: an edit sends the changed text again from that message
   * on, as Try again does; a withdrawal takes the message and Forma's answers
   * to it out of the transcript; a version is another the message had (see
   * `ChatMessage.branches`).
   */
  onEdit?: (id: string, text: string) => void;
  onWithdraw?: (id: string) => void;
  onShowVersion?: (id: string, to: number) => void;
  /** The pill's Try again, on a request that failed. */
  onRetry: (id: string) => void;
  /** A picture sent with the request, opened in the viewer. */
  onOpenAttachment: (view: AttachmentView) => void;
  /**
   * A turn under way from its first step to its last (App's `turnBusy`), so
   * what is announced waits for its end rather than for a pause between its
   * steps, as between a picture read and the chat asked.
   */
  busy?: boolean;
  /** The requests whose change to the report can be shown, outlined on the Preview, as the log's pick did. */
  changed?: ReadonlySet<string>;
  onShowChange?: (id: string) => void;
  /** The request whose change is shown, marked current. */
  currentId?: string | null;
  /** The search, held by App so a project left clears it. */
  onQuery?: (query: string) => void;
  /** Bumped to open the search from outside, as the command menu does. */
  revealSearch?: number;
  /** The conversation downloaded as Markdown, the log's download until 2026-11-08. */
  onExport?: () => void;
  /** What sits at the panel's foot: the tip, a notice and the box. */
  foot?: ReactNode;
}

/**
 * The panel's one status region (2026-11-07, agent audit item 7): mounted
 * empty and kept, so a screen reader hears "Forma is working on it." when a
 * request starts and, when it settles, what came of it (`requestAnnouncement`).
 * Each announcement is a new child, so the same words said twice are said.
 */
function useAnnouncement<R>(request: ChatRequest<R, PreviewMeta> | null, latest: boolean, working: boolean) {
  const [said, setSaid] = useState({ text: '', n: 0 });
  const wasWorking = useRef(false);
  useEffect(() => {
    if (!latest || !request) return;
    if (working) {
      if (!wasWorking.current) {
        wasWorking.current = true;
        setSaid((s) => ({ text: 'Forma is working on it.', n: s.n + 1 }));
      }
      return;
    }
    if (!wasWorking.current) return;
    wasWorking.current = false;
    const text = requestAnnouncement(request as ChatRequest);
    if (text) setSaid((s) => ({ text, n: s.n + 1 }));
  }, [request, latest, working]);
  return said;
}

/** What the person asked, pinned at the top of its request. */
function AskPill<R>({
  ask,
  initials,
  disabled,
  onEdit,
  onWithdraw,
  onShowVersion,
  onOpenAttachment,
  onRetry,
  onShowChange,
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
  /** Outline on the Preview what this request changed, the log's pick until 2026-11-08. */
  onShowChange?: () => void;
  /** The search, marked in the words asked as in the replies (agent audit item 30). */
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
          {onShowChange && (
            <button type="button" className="wb-note-act wb-note-icon" title="Show what it changed on the Preview" aria-label="Show what it changed" onClick={onShowChange}>
              <IconEye size={13} />
            </button>
          )}
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

/**
 * Every match of the search in turn (2026-11-08): the log's search marked the
 * matches in the one request the card showed; in a thread the matches are
 * spread down it, so Enter goes to the next, and a new search to the first.
 */
function useSearchJump(threadHost: React.RefObject<HTMLDivElement | null>, query: string) {
  const at = useRef(-1);
  const go = (step: number) => {
    const hits = threadHost.current ? [...threadHost.current.querySelectorAll<HTMLElement>('mark.wb-hit')] : [];
    if (!hits.length) return;
    at.current = (at.current + step + hits.length) % hits.length;
    hits[at.current].scrollIntoView?.({ block: 'center' });
  };
  useEffect(() => {
    at.current = -1;
    if (query.trim()) requestAnimationFrame(() => go(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new query starts at its first match
  }, [query]);
  return go;
}

/**
 * The agent's mark, as Stitch's (2026-11-08): two white dots on a black pill,
 * at the panel's top left and in its folded square, the dots taking turns
 * while Forma works. The owner chose Stitch's own icons that day; agent audit
 * item 98 had replaced them on 2026-11-07 with a minimise line and a chat
 * bubble, judging the dots to read as someone typing.
 */
function AgentMark({ working }: { working: boolean }) {
  return (
    <span className={`wb-agent-mark${working ? ' is-working' : ''}`} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

export default function ConversationPanel<R>({
  requests,
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
  busy = false,
  changed,
  onShowChange,
  currentId = null,
  onQuery,
  revealSearch = 0,
  onExport,
  foot,
  children,
  ...thread
}: ConversationPanelProps<R>) {
  const newest = requests[requests.length - 1] ?? null;
  const said = useAnnouncement(newest, true, isChatting || isAnalyzing || busy);
  const query = thread.query ?? '';
  const [searching, setSearching] = useState(query.trim().length > 0);
  const searchRef = useRef<HTMLInputElement>(null);
  const threadHost = useRef<HTMLDivElement>(null);
  const jump = useSearchJump(threadHost, query);
  useEffect(() => {
    if (!revealSearch) return;
    setSearching(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [revealSearch]);
  const closeSearch = () => {
    setSearching(false);
    onQuery?.('');
  };
  const working = isChatting || isAnalyzing || busy;
  return (
    <section className={`wb-panel${collapsed ? ' wb-is-collapsed' : ''}${requests.length || working ? '' : ' wb-is-empty'}`} aria-label="Conversation">
      <div className="wb-reply-said" role="status" aria-live="polite">
        {said.text ? <span key={said.n}>{said.text}</span> : null}
      </div>
      {collapsed ? (
        /* Folded, as Stitch's: a rounded square holding the agent's mark,
           which turns to Expand under the pointer or the keyboard's focus
           (2026-11-08, the owner's choice of Stitch's own icons). */
        <button
          type="button"
          className="wb-panel-expand"
          aria-expanded={false}
          aria-label="Expand the conversation"
          title="Expand"
          onClick={onToggle}
        >
          <AgentMark working={working} />
          <span className="wb-panel-expand-ic" aria-hidden="true">
            <IconExpand size={18} />
          </span>
        </button>
      ) : (
        <div className="wb-panel-head">
          <AgentMark working={working} />
          <span className="wb-panel-gap" />
          {requests.length > 0 && (
            <>
              <button
                type="button"
                className="wb-panel-tool"
                aria-expanded={searching}
                aria-label="Search the conversation"
                title="Search the conversation"
                onClick={() => (searching ? closeSearch() : (setSearching(true), requestAnimationFrame(() => searchRef.current?.focus())))}
              >
                <IconSearch size={14} />
              </button>
              {onExport && (
                <button type="button" className="wb-panel-tool" aria-label="Download the conversation" title="Download the conversation as Markdown" onClick={onExport}>
                  <IconDownload size={14} />
                </button>
              )}
            </>
          )}
          <button type="button" className="wb-panel-tool wb-panel-collapse" aria-expanded aria-label="Collapse the conversation" title="Collapse" onClick={onToggle}>
            <IconCollapse size={18} />
          </button>
        </div>
      )}
      {/* Folded, the panel hides what it holds rather than dropping it
          (agent audit item 32): answers typed into Forma's questions, an edit
          of a message and the words in the box are kept. */}
      <div className="wb-panel-convo" hidden={collapsed}>
        {searching && !collapsed && (
          <div className="wb-panel-search">
            <IconSearch size={13} />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search the conversation"
              placeholder="Search the conversation"
              value={query}
              onChange={(e) => onQuery?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  jump(e.shiftKey ? -1 : 1);
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  closeSearch();
                }
              }}
            />
          </div>
        )}
        <div className="wb-panel-thread" ref={threadHost}>
          {/* A fault in the thread stays in it: the box below is outside, so
              it can still be typed in (the card's boundary held the card alone). */}
          <ErrorBoundary area="the conversation">
          <ChatThread
            {...thread}
            messages={requests.flatMap((r) => r.replies)}
            turns={requests}
            currentTurn={currentId}
            isChatting={isChatting}
            isAnalyzing={isAnalyzing}
            // Between a turn's steps too (2026-11-11, the full audit's WS-19): Try again,
            // Edit and Withdraw cut the thread, and the turn under way refused what they sent.
            busy={busy}
            renderAsk={({ id, ask }) => (
              <AskPill
                key={id}
                ask={ask}
                initials={initials}
                disabled={working}
                onEdit={onEdit}
                onWithdraw={onWithdraw}
                onShowVersion={onShowVersion}
                onOpenAttachment={onOpenAttachment}
                onRetry={onRetry}
                onShowChange={changed?.has(id) && onShowChange ? () => onShowChange(id) : undefined}
                query={query}
              />
            )}
          >
            {children}
          </ChatThread>
          </ErrorBoundary>
        </div>
      </div>
      <div className="wb-panel-foot">{foot}</div>
    </section>
  );
}
