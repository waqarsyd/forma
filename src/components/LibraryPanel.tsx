/**
 * The report library: the files it holds, and what goes into it.
 *
 * The visible half of milestone 6 in `docs/proposals/rag.md`. `services/library.ts`
 * does the work; this shows what is in the library, takes `.repx` files in, and
 * lets a file be taken back out.
 *
 * ## Curation is a control, not a nicety
 *
 * The 19 real reports this feature was measured against include five
 * `Job_Card_Report (1)…(5)` variants, two near-empty files of one and three chunks,
 * and 13 fragments duplicated across files. Importing a folder wholesale would make
 * drafts and stubs into house style, and the model would then be shown them as
 * examples of how this organisation formats reports.
 *
 * So **canonical is per file and off by default**. A file contributes to retrieval
 * only once someone has said it should. That is the *"who decides what is
 * canonical"* question from the proposal, answered as an explicit act rather than
 * by an import path.
 *
 * ## Only `.repx` goes in
 *
 * A screenshot or a PDF has no structure `repxChunks` can read, so admitting one
 * would add a file to the list that contributes nothing and looks broken. The
 * picker filters, and a file that produces no chunks is reported by name rather
 * than silently ignored — `Sample empt report..repx` in the real corpus is exactly
 * that case.
 *
 * ## It counts reports, not fragments
 *
 * What the panel says counts the files a person added, and says a file whose
 * pieces are not all searchable yet is still being read (2026-11-11, the full
 * audit's WS-24). "4 fragment(s) added · 2 still to embed" described the
 * library's machinery, not the reports the person chose.
 */
import { useCallback, useRef, useState } from 'react';
import type { ImportResult, LibrarySource } from '../services/library';

/** "1 report", "3 reports". */
const reports = (n: number) => `${n} report${n === 1 ? '' : 's'}`;

/**
 * What an import says: the reports added, and those the library already held,
 * by file name, since the import's own counts are of fragments.
 */
function importNotice(files: readonly string[], held: ReadonlySet<string>, result: Pick<ImportResult, 'empty' | 'added'>): string {
  const read = files.filter((name) => !result.empty.includes(name));
  const already = read.filter((name) => held.has(name)).length;
  const added = read.length - already;
  // The library keeps pieces by their content, not the file's name, so a held
  // name whose content changed still adds pieces (2026-11-11, WS-24's review).
  // When every name was held and something was added, it was an update.
  if (added === 0 && already > 0 && result.added > 0) return `Updated ${reports(already)}.`;
  const parts: string[] = [];
  if (added > 0) parts.push(`Added ${reports(added)}.`);
  if (already > 0) parts.push(`${already === 1 ? '1 report was' : `${already} reports were`} already in the library.`);
  return parts.join(' ');
}

/** The reports whose pieces are not all searchable yet, said once for the whole list; '' when none. */
function readingNotice(sources: readonly LibrarySource[]): string {
  const waiting = sources.filter((s) => s.embedded < s.chunks).length;
  if (!waiting) return '';
  return `${waiting === 1 ? '1 report is' : `${waiting} reports are`} still being read; ${waiting === 1 ? 'it is' : 'they are'} used once ready.`;
}

export interface LibraryPanelProps {
  /** One row per file already in the library. */
  sources: readonly LibrarySource[];
  /** Which file names count as house style. */
  canonical: ReadonlySet<string>;
  /** Reads the chosen files and puts them in the library. */
  onImport: (files: File[]) => Promise<ImportResult>;
  onRemove: (name: string) => void;
  onToggleCanonical: (name: string, canonical: boolean) => void;
  /** False when there is no API key — importing needs one, to embed. */
  ready: boolean;
  onNeedKey: () => void;
}

export default function LibraryPanel({
  sources,
  canonical,
  onImport,
  onRemove,
  onToggleCanonical,
  ready,
  onNeedKey,
}: LibraryPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const add = useCallback(
    /** @param leftOut files dropped with these that are not reports, named in the notice. */
    async (files: File[], leftOut: readonly string[] = []) => {
      if (files.length === 0) return;
      setBusy(true);
      setError('');
      setNotice('');
      const held = new Set(sources.map((s) => s.name));
      try {
        const result = await onImport(files);
        const left = leftOut.length ? ` Only .repx files go into the library, so ${leftOut.join(', ')} ${leftOut.length === 1 ? 'was' : 'were'} left out.` : '';
        setNotice(importNotice(files.map((f) => f.name), held, result) + left);
        // Also takes down a "Still adding" said to a drop made meanwhile.
        setError(result.empty.length ? `Nothing in ${result.empty.join(', ')} could be read as a report.` : '');
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'The reports could not be added.');
      } finally {
        setBusy(false);
      }
    },
    [onImport, sources],
  );
  const chosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // The picker is reset immediately so the same file can be chosen twice --
    // after a failure, re-picking it is the obvious thing to try.
    event.target.value = '';
    void add(files);
  };
  /*
   * Reports dropped on the panel go into the library (2026-11-11, the full
   * audit's WS-13). The drop reached the workspace behind it, which attached
   * the file to the message box the panel covers. Kept here, whatever was
   * dropped: a file that is not a .repx is said so, not sent elsewhere.
   */
  const dropped = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    // Said, not swallowed (the WSX1 review): a drop while reports are still
    // going in, and the files of a mixed drop that are not reports.
    if (busy) {
      setError('Still adding the last reports. Drop these again in a moment.');
      return;
    }
    const reportsOnly = files.filter((file) => /\.repx$/i.test(file.name));
    if (!ready) {
      onNeedKey();
      return;
    }
    setNotice('');
    setError(reportsOnly.length ? '' : 'Only .repx files go into the library.');
    const leftOut = files.filter((file) => !reportsOnly.includes(file)).map((file) => file.name);
    void add(reportsOnly, leftOut);
  };

  const reading = readingNotice(sources);

  return (
    <div
      className="lp-panel"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={dropped}
    >
      {/* Button above the prose, and the outline pill rather than the accent one:
          both match BatchPanel, which is the panel beside this one in the rail.
          An accent pill here would compete with "New report" in the same column. */}
      <div className="lp-actions">
        <button
          className="wb-pill wb-pill--outline"
          disabled={busy}
          onClick={() => (ready ? input.current?.click() : onNeedKey())}
        >
          {busy ? 'Adding…' : 'Add .repx files'}
        </button>
        <input
          ref={input}
          type="file"
          accept=".repx"
          multiple
          hidden
          onChange={chosen}
        />
      </div>

      <p className="lp-intro">
        Reports you have already published. Forma matches their formatting when you ask it to.
      </p>

      {!ready && (
        <p className="lp-hint">Adding reports needs your Gemini key.</p>
      )}
      {notice && <p className="lp-notice">{notice}</p>}
      {error && <p className="lp-error">{error}</p>}

      {sources.length === 0 ? (
        <p className="lp-empty">
          Nothing here yet. Add a few reports that look the way you want new ones to look.
        </p>
      ) : (
        <>
          <p className="lp-summary">{reports(sources.length)}</p>
          {reading && <p className="lp-hint">{reading}</p>}
          <ul className="lp-list">
            {sources.map((source) => {
              const isCanonical = canonical.has(source.name);
              return (
                <li className="lp-row" key={source.name}>
                  {/* A report the person kept joined on its own and needs no tick (2026-11-11, D2): an empty cell, not an empty label. */}
                  {source.kept ? (
                    <span className="lp-canonical" />
                  ) : (
                    <label className="lp-canonical">
                      <input
                        type="checkbox"
                        checked={isCanonical}
                        onChange={(e) => onToggleCanonical(source.name, e.target.checked)}
                        aria-label={`Use ${source.name} as house style`}
                      />
                    </label>
                  )}
                  <span className="lp-name" title={source.name}>
                    {source.name}
                  </span>
                  <span className="lp-count">
                    {source.kept ? 'You kept this' : source.embedded < source.chunks && 'Being read'}
                  </span>
                  <button className="wb-pill wb-pill--outline" onClick={() => onRemove(source.name)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          {canonical.size === 0 && sources.some((s) => !s.kept) && (
            <p className="lp-hint">
              Tick the reports that represent your house style. Nothing you add is used until you do.
            </p>
          )}
        </>
      )}
    </div>
  );
}
