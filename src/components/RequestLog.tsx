/**
 * Every request of the open project, beneath the card (2026-11-05), as
 * Google Stitch's Agent log: folded to one line at the bottom left of the
 * report, it opens upward into the requests, newest first, each with a mark
 * for where it stands. Picking one shows it in the card, and Preview outlines
 * the controls it changed. The transcript search and the Markdown export,
 * which sat in the chat column's head until the column went, live here.
 * Since 2026-11-06, as Stitch's: the running request has a Stop beside it,
 * and a title too long for its row scrolls sideways while it is hovered.
 * See *The conversation floats over the report* in docs/notes/app-shell.md.
 */
import { useState, type CSSProperties } from 'react';
import { requestMatches, requestState, requestTitle, type ChatRequest } from '../lib/chatSession';
import { IconAlert, IconCheckCircle, IconChevronDown, IconClose, IconDownload, IconInfo, IconStack } from './landing/icons';
import './overlays.css';

/** A title that does not fit its row slides to its end while hovered, at 40 px a second. */
function Title({ text }: { text: string }) {
  const [shift, setShift] = useState(0);
  return (
    <span
      className={`wb-log-text${shift ? ' is-scrolling' : ''}`}
      style={shift ? ({ '--shift': `-${shift}px`, '--slide': `${Math.max(0.6, shift / 40)}s` } as CSSProperties) : undefined}
      onMouseEnter={(e) => {
        const over = e.currentTarget.scrollWidth - e.currentTarget.clientWidth;
        if (over > 2) setShift(over);
      }}
      onMouseLeave={() => setShift(0)}
    >
      <span>{text}</span>
    </span>
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
  /** Stops the running request, from its row, as the box's Stop does. */
  onStop?: () => void;
}

export default function RequestLog({ requests, shownId, working, onShow, onExport, onStop }: RequestLogProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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
            {shown.map((r) => {
              const state = working && r.id === newestId ? 'working' : requestState(r);
              return (
                <li key={r.id}>
                  <button type="button" aria-current={r.id === shownId ? 'true' : undefined} onClick={() => onShow(r.id)}>
                    <span className={`wb-log-mark wb-log-mark--${state}`} aria-label={STATE_WORDS[state]} role="img">
                      {state === 'working' ? <span className="wb-spin" /> : state === 'failed' ? <IconAlert size={14} /> : state === 'waiting' ? <IconInfo size={14} /> : <IconCheckCircle size={14} />}
                    </span>
                    <Title text={requestTitle(r)} />
                  </button>
                  {state === 'working' && onStop && (
                    <button type="button" className="wb-log-stop" aria-label="Stop this request" title="Stop" onClick={onStop}>
                      <IconClose size={12} />
                    </button>
                  )}
                </li>
              );
            })}
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
