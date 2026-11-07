/**
 * Every request of the open project, beneath the card (2026-11-05), as
 * Google Stitch's Agent log: folded to one line at the bottom left of the
 * report, it opens upward into the requests, newest first, each with a mark
 * for where it stands. Picking one shows it in the card, and Preview outlines
 * the controls it changed. The transcript search and the Markdown export,
 * which sat in the chat column's head until the column went, live here.
 * Since 2026-11-06, as Stitch's, a title too long for its row scrolls
 * sideways while it is hovered. The running request had a Stop beside it the
 * same day, a second Stop beside the box's; the workspace audit left the box's
 * alone, which now stays while words are typed. A search marks what it found
 * in the card too (`query`, App passes it on). See *The conversation floats
 * over the report* in docs/notes/app-shell.md.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { requestMatches, requestState, requestTitle, type ChatRequest } from '../lib/chatSession';
import { IconAlert, IconCheckCircle, IconChevronDown, IconDownload, IconInfo, IconStack } from './landing/icons';
import './overlays.css';

/**
 * A title that does not fit its row slides to its end while hovered, at 40 px
 * a second, and since 2026-11-07 while its row has the keyboard's focus too
 * (agent audit item 64): it could be read whole only with a mouse. The whole
 * title is the row's tooltip as well.
 */
function Title({ text, active }: { text: string; active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) {
      setShift(0);
      return;
    }
    const over = el.scrollWidth - el.clientWidth;
    setShift(over > 2 ? over : 0);
  }, [active]);
  return (
    <span
      ref={ref}
      className={`wb-log-text${shift ? ' is-scrolling' : ''}`}
      style={shift ? ({ '--shift': `-${shift}px`, '--slide': `${Math.max(0.6, shift / 40)}s` } as CSSProperties) : undefined}
    >
      <span>{text}</span>
    </span>
  );
}

/** One request in the log: its mark and its title, which slides while hovered or focused. */
function LogItem({ request, state, current, onShow }: { request: ChatRequest; state: keyof typeof STATE_WORDS; current: boolean; onShow: (id: string) => void }) {
  const [active, setActive] = useState(false);
  const title = requestTitle(request);
  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        title={title}
        onClick={() => onShow(request.id)}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
      >
        <span className={`wb-log-mark wb-log-mark--${state}`} aria-label={STATE_WORDS[state]} role="img">
          {state === 'working' ? <span className="wb-spin" /> : state === 'failed' ? <IconAlert size={14} /> : state === 'waiting' ? <IconInfo size={14} /> : <IconCheckCircle size={14} />}
        </span>
        <Title text={title} active={active} />
      </button>
    </li>
  );
}

export interface RequestLogProps {
  /** Oldest first, as `requestsOf` gives them. */
  requests: readonly ChatRequest[];
  /** The request in the card. */
  shownId: string | null;
  /** The newest request is still being answered. */
  working: boolean;
  onShow: (id: string) => void;
  /** The conversation as a Markdown file. */
  onExport?: () => void;
  /** The words searched for, told to App so the card marks them too (2026-11-06). */
  onQuery?: (query: string) => void;
  /**
   * The words searched for, held by App (2026-11-07, agent audit item 29):
   * the log kept its own, which a remount on the first save emptied while
   * the card went on marking the old ones. Its own when absent.
   */
  query?: string;
  /** Changed to open the log, from the command menu (2026-11-07, agent audit item 66). */
  reveal?: number;
  /** Told when the log opens or closes, so the card above can make room (agent audit item 76). */
  onOpenChange?: (open: boolean) => void;
}

export default function RequestLog({ requests, shownId, working, onShow, onExport, onQuery, query: heldQuery, reveal = 0, onOpenChange }: RequestLogProps) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean | ((was: boolean) => boolean)) =>
    setOpenState((was) => {
      const now = typeof next === 'function' ? next(was) : next;
      if (now !== was) onOpenChange?.(now);
      return now;
    });
  useEffect(() => {
    if (reveal) setOpen(true);
    // setOpen is this render's; the reveal count is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);
  const [ownQuery, setOwnQuery] = useState('');
  const query = heldQuery ?? ownQuery;
  const setQuery = (next: string) => {
    if (heldQuery === undefined) setOwnQuery(next);
    onQuery?.(next);
  };
  const newestId = requests[requests.length - 1]?.id;
  const shown = [...requests].reverse().filter((r) => requestMatches(r, query));
  return (
    <section className={`wb-log${open ? ' wb-is-open' : ''}`} aria-label="Requests">
      {open && (
        <div className="wb-log-body">
          <div className="wb-log-tools">
            <input
              type="search"
              value={query}
              placeholder="Search requests"
              aria-label="Search requests"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
              }}
            />
            {onExport && (
              <button type="button" className="wb-icon-btn" title="Export the chat as a Markdown file" aria-label="Export the chat" onClick={onExport}>
                <IconDownload size={14} />
              </button>
            )}
          </div>
          <ul className="wb-log-list">
            {shown.map((r) => (
              <LogItem key={r.id} request={r} state={working && r.id === newestId ? 'working' : requestState(r)} current={r.id === shownId} onShow={onShow} />
            ))}
            {shown.length === 0 && <li className="wb-log-none">No request holds that.</li>}
          </ul>
        </div>
      )}
      <button type="button" className="wb-log-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconStack size={15} />
        <span>Requests</span>
        <span className="wb-log-count">{requests.length}</span>
        <IconChevronDown size={14} />
      </button>
    </section>
  );
}

const STATE_WORDS = { working: 'Working', failed: 'Failed', waiting: 'Waiting for you', done: 'Answered' } as const;
