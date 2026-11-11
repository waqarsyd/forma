/**
 * The Projects panel: every saved project, searched, pinned, archived, renamed
 * in place, duplicated and deleted (2026-11-11, out of App.tsx, the full
 * audit's WSX1 batch).
 *
 * It moved for the room: the App chunk stood at 99.9% of its budget, and the
 * fixes below had to be paid for by moving code out rather than by raising
 * it. Lazy, like the Revisions, Batch and library panels beside it, and drawn
 * only while it is the panel shown. The list's state that is the panel's own
 * (a rename being typed, the Clear all question, the archive opened) lives
 * here; what the rest of the workspace reads (the search, the pins, the
 * archive) stays in App and comes in as props. The history of the panel
 * itself, the two lists it merged in 2026-09-06 and why, is in
 * `git log -S"wb-chat-search" -- src/App.tsx`.
 *
 * What the audit changed, each where it is drawn:
 *
 * - **A row opens from the keyboard** (WS-14): its name is a button, the open
 *   project's carrying `aria-current`. The row was a `<div>` with a click
 *   handler, reachable by its small action buttons only.
 * - **The open project's row reopens nothing** (WS-15): clicking it reloaded
 *   the project from its last save, dropping the undo history and, signed
 *   out, every revision. It is still `onOpen`, and App answers it by going
 *   back to the conversation, the project untouched.
 * - **A project being opened says so** (WS-16): a spinner on its row while its
 *   content is fetched.
 * - **The panel says its own errors** (WS-12): a failed list, rename,
 *   duplicate or delete is said here, where the person is looking. It went to
 *   the composer's error line, which the panel covers, and a list that failed
 *   to load said "No saved projects yet."
 * - **Delete has an Undo** (WS-03): the row goes at once and App's toast
 *   offers Undo for six seconds (lib/deferredDelete.ts), so the trash asks
 *   nothing and loses nothing. Clear all still asks first, being every project.
 */
import { useState } from 'react';
import { arrangeProjects, deviceProjectsLine } from '../lib/savedReport';
import { noteCountLabel, projectMatches } from '../lib/chatSession';
import { formatSessionStamp } from '../lib/datetime';
import { IconArchive, IconClose, IconCopy, IconPencil, IconPin, IconSearch, IconTrash } from './landing/icons';

/** What a row needs of a saved project. */
export interface ProjectRow {
  id: string;
  name: string;
  timestamp: string;
  messages: readonly { text: string; clarify?: { questions: { question: string }[] } }[];
  stub?: boolean;
  search?: string;
  notes?: number;
}

export interface ProjectsPanelProps {
  /** The saved projects, without those waiting to be deleted. */
  projects: readonly ProjectRow[];
  openId: string | null;
  /** A project whose content is on its way (WS-16). */
  openingId?: string | null;
  /** The search, open as '' or holding what is typed; null while closed. */
  query: string | null;
  onQuery: (query: string | null) => void;
  pinned: readonly string[];
  archived: readonly string[];
  /** A failure of the list or of something done to it (WS-12). */
  error?: string | null;
  onDismissError?: () => void;
  /** Projects made in this browser before signing in, and the offer to add them (SA-04). */
  device?: { count: number; adding: boolean; onAdd: () => void } | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleArchive: (id: string) => void;
  onDelete: (ids: string[]) => void;
}

export default function ProjectsPanel({
  projects,
  openId,
  openingId = null,
  query,
  onQuery,
  pinned,
  archived,
  error = null,
  onDismissError,
  device = null,
  onOpen,
  onRename,
  onDuplicate,
  onTogglePin,
  onToggleArchive,
  onDelete,
}: ProjectsPanelProps) {
  /** The project whose name is being typed over, and the words so far. */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  /** Two-step confirm for "Clear all". A native confirm() is banned here. */
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = projects.filter((r) => archived.includes(r.id)).length;
  const rename = (id: string, typed: string) => {
    setRenaming(null);
    onRename(id, typed);
  };

  return (
    <div className="wb-panel-body">
      <div className="wb-col-head">
        <h2 className="wb-col-title">Projects</h2>
        {/* Two-step, in place: "Clear all" deleting every saved project on a
            single stray click is exactly the case a confirm exists for. */}
        {confirmingClearAll ? (
          <span className="wb-kicker wb-confirm">
            <span>Delete all {projects.length}?</span>
            <button
              className="wb-mini wb-danger"
              onClick={() => {
                onDelete(projects.map((r) => r.id));
                setConfirmingClearAll(false);
              }}
            >
              Delete
            </button>
            <button className="wb-mini" onClick={() => setConfirmingClearAll(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <span className="wb-kicker">
            {projects.length} saved
            {projects.length > 0 && (
              <button className="wb-mini" onClick={() => setConfirmingClearAll(true)} title="Delete every saved project">
                Clear all
              </button>
            )}
          </span>
        )}
      </div>
      {/* The sidebar's Search (2026-11-05): the projects whose name or chat
          holds what is typed, as ChatGPT's search finds chats. Escape with
          words typed clears the search; with none it closes the panel too,
          which the sidebar's Search opened with it. */}
      {query !== null && (
        <div className="wb-chat-search">
          <IconSearch size={13} />
          <input
            type="search"
            value={query}
            autoFocus
            placeholder="Search projects"
            aria-label="Search projects"
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              if (query) e.preventDefault();
              onQuery(null);
            }}
          />
          <button type="button" title="Close the search" aria-label="Close the search" onClick={() => onQuery(null)}>
            <IconClose size={13} />
          </button>
        </div>
      )}
      {/* Made here before signing in (2026-11-11, the full audit's SA-04):
          said, and added when asked, never on its own, since a shared
          browser's projects may be someone else's. */}
      {device && device.count > 0 && (
        <p className="wb-empty" role="status">
          {deviceProjectsLine(device.count)}{' '}
          <button type="button" className="wb-mini" disabled={device.adding} onClick={device.onAdd}>
            {device.adding ? 'Adding…' : device.count === 1 ? 'Add it to your account' : 'Add them to your account'}
          </button>
        </p>
      )}
      {error && (
        <p className="wb-empty" role="alert">
          {error}{' '}
          {onDismissError && (
            <button type="button" className="wb-mini" onClick={onDismissError}>
              Dismiss
            </button>
          )}
        </p>
      )}
      <div className="wb-list">
        {projects.length === 0 ? (
          // A list that failed to load is not an empty one (WS-12): the error above says which.
          error ? null : <div className="wb-empty">No saved projects yet.</div>
        ) : query && !projects.some((r) => projectMatches(r, query)) ? (
          <div className="wb-empty">No project holds that.</div>
        ) : (
          arrangeProjects(projects.filter((r) => projectMatches(r, query ?? '')), pinned, archived, showArchived).map((report) => {
            // Day and time. A bare clock time was the same six characters
            // for a session from this morning and one from last month.
            const stamp = formatSessionStamp(report.timestamp);
            const open = report.id === openId;
            const opening = report.id === openingId;
            const isPinned = pinned.includes(report.id);
            const isArchived = archived.includes(report.id);
            return (
              <div
                key={report.id}
                className={`wb-card${open ? ' wb-is-open' : ''}`}
                // The open project's row reopens nothing (WS-15): App takes it
                // back to the conversation as it is. The name's button is the
                // keyboard's way in, and its click lands here.
                onClick={() => {
                  if (renaming?.id !== report.id) onOpen(report.id);
                }}
              >
                {/* A rename typed in place (2026-11-05): Enter keeps it, Escape or leaving puts it back. */}
                {renaming?.id === report.id ? (
                  <input
                    className="wb-ctl wb-rename"
                    aria-label={`Rename ${report.name}`}
                    value={renaming.name}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ id: report.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(report.id, renaming.name);
                      if (e.key === 'Escape') {
                        // The rename's own Escape, not the panel's.
                        e.preventDefault();
                        setRenaming(null);
                      }
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <button
                    type="button"
                    // The name as a button that reads as the row's text (`.wb-card-open` in workspace.css).
                    className="wb-nm wb-card-open"
                    aria-current={open ? 'true' : undefined}
                    aria-busy={opening || undefined}
                  >
                    {opening ? <span className="wb-spin" aria-hidden="true" /> : isPinned && <IconPin size={11} />}
                    {report.name}
                  </button>
                )}
                <div className="wb-sub">
                  {opening ? 'Opening… · ' : stamp && `${stamp} · `}
                  {noteCountLabel(report.stub ? report.notes ?? 0 : report.messages.length)}
                </div>
                <div className="wb-row-actions">
                  <button
                    aria-label={isPinned ? `Unpin ${report.name}` : `Pin ${report.name}`}
                    aria-pressed={isPinned}
                    title={isPinned ? 'Unpin' : 'Pin to the top (on this device)'}
                    onClick={(e) => { e.stopPropagation(); onTogglePin(report.id); }}
                  >
                    <IconPin size={14} />
                  </button>
                  <button
                    aria-label={`Rename ${report.name}`}
                    title="Rename"
                    onClick={(e) => { e.stopPropagation(); setRenaming({ id: report.id, name: report.name }); }}
                  >
                    <IconPencil size={14} />
                  </button>
                  {/* As the title's menu has it (2026-11-06, the workspace audit). */}
                  <button
                    aria-label={`Duplicate ${report.name}`}
                    title="Duplicate"
                    onClick={(e) => { e.stopPropagation(); onDuplicate(report.id); }}
                  >
                    <IconCopy size={14} />
                  </button>
                  <button
                    aria-label={isArchived ? `Unarchive ${report.name}` : `Archive ${report.name}`}
                    title={isArchived ? 'Back to projects' : 'Archive (on this device)'}
                    onClick={(e) => { e.stopPropagation(); onToggleArchive(report.id); }}
                  >
                    <IconArchive size={14} />
                  </button>
                  <button
                    className="wb-danger"
                    aria-label={`Delete ${report.name}`}
                    title="Delete (Undo for a few seconds)"
                    onClick={(e) => { e.stopPropagation(); onDelete([report.id]); }}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {/* The archive, kept on this device (2026-11-05): out of the list until opened. */}
      {(showArchived || archivedCount > 0) && (
        <button type="button" className="wb-mini wb-archive-toggle" onClick={() => setShowArchived((was) => !was)}>
          <IconArchive size={12} />
          {showArchived ? 'Back to projects' : `Archived (${archivedCount})`}
        </button>
      )}
    </div>
  );
}
