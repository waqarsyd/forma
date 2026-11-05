/**
 * Batch intake: a folder of legacy reports in, a queue of `.repx` out.
 *
 * ## Why this is not the composer with more files
 *
 * Attaching several files to the composer means ONE report assembled from
 * several pages. This means the opposite — N source documents, N separate
 * reports — and the two are indistinguishable from the files themselves. So
 * the distinction is made by where the files are dropped, which is why this is
 * its own panel rather than a checkbox.
 *
 * It is also the only part of the product that answers the migration question:
 * you can describe one report to an assistant, but you cannot describe forty
 * you have never read.
 *
 * ## What a row is for
 *
 * Not "it finished". The point of running forty files is knowing which of the
 * forty are worth opening, so each row carries the audit's verdict — clean, N
 * warnings, or N errors and content will be lost — in the same words the
 * status bar uses for a single report. `batchQueue.ts` owns those states; this
 * file owns the running of them.
 */
import { useCallback, useRef, useState } from 'react';
import {
  createQueue, nextPending, markRunning, markDone, markFailed,
  cancelPending, retryUnfinished, summarise, verdict, outputName,
  BATCH_PARALLEL, type BatchItem, type BatchOutcome,
} from '../lib/batchQueue';
import { filesFromDrop, filesFromPicker, forBatch, MAX_BATCH_FILES, type GivenFile } from '../lib/folderDrop';
import { buildZip } from '../lib/zip';

interface Props {
  /**
   * Runs one file through the ordinary generation path. Supplied by App.
   *
   * Takes the item's id so App can keep the FULL result — markdown, layout and
   * all — under it. `BatchOutcome` deliberately carries only what a row shows,
   * because `batchQueue.ts` is a pure module and has no business knowing what a
   * workspace result looks like; "Open" then asks App for the rest by id.
   */
  runOne: (file: File, signal: AbortSignal, id: string) => Promise<BatchOutcome>;
  /** Loads a finished item into the workspace. */
  onOpen: (item: BatchItem) => void;
  /** False when there is no API key; the panel explains rather than failing. */
  ready: boolean;
  onNeedKey: () => void;
}

const STATUS_DOT: Record<string, string> = {
  pending: 'var(--ink-faint, #7a8592)',
  running: 'var(--warn, #b45309)',
  done: 'var(--ok-ink, #1f6f49)',
  failed: 'var(--bad, #b3261e)',
  cancelled: 'var(--ink-faint, #7a8592)',
};

export default function BatchPanel({ runOne, onOpen, ready, onNeedKey }: Props) {
  const [queue, setQueue] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  /** How many files run at once (2026-11-04); one unless the person chooses more. */
  const [parallel, setParallel] = useState<number>(BATCH_PARALLEL[0]);
  const [dragging, setDragging] = useState(false);
  const filesRef = useRef<Map<string, File>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /* The loop reads the queue through a ref rather than through state: it runs
     across many awaits, and a closure over `queue` would see the array as it
     was when the run started and overwrite every result but the last. */
  const queueRef = useRef<BatchItem[]>([]);

  const setBoth = (next: BatchItem[]) => {
    queueRef.current = next;
    setQueue(next);
  };

  const summary = summarise(queue);

  /**
   * Files from the picker, the folder picker or a drop, as the queue. What
   * the batch cannot take (a spreadsheet, a hidden file) is left out and
   * counted, and a folder's files queue in path order.
   */
  const addFiles = (given: readonly GivenFile[]) => {
    if (!given.length || running) return;
    const { files, skipped, truncated } = forBatch(given);
    if (!files.length) {
      setNotice(`Nothing here the batch can take: it reads images, PDFs and .repx files.`);
      return;
    }
    const next = createQueue(files.map((f) => f.path));
    filesRef.current = new Map(next.map((item, i) => [item.id, files[i].file]));
    setBoth(next);
    const left = [
      skipped > 0 ? `${skipped} other file${skipped === 1 ? '' : 's'} left out` : '',
      truncated ? `only the first ${MAX_BATCH_FILES} taken` : '',
    ].filter(Boolean);
    setNotice(
      `${files.length} file${files.length === 1 ? '' : 's'} ready${left.length ? ` (${left.join('; ')})` : ''}. Nothing is sent until you start.`,
    );
  };

  const run = useCallback(async () => {
    if (!ready) { onNeedKey(); return; }
    setRunning(true);
    setNotice('');
    const controller = new AbortController();
    abortRef.current = controller;
    let halted = false;

    // One at a time unless the person chose more (see batchQueue.ts): the
    // user's own key carries the quota, and forty parallel requests turn a
    // slow success into a fast 429. Each worker claims its item synchronously,
    // in the same turn it finds it, so two never take the same file.
    const worker = async () => {
      for (;;) {
        const item = nextPending(queueRef.current);
        if (!item || controller.signal.aborted || halted) return;
        setBoth(markRunning(queueRef.current, item.id));
        const file = filesRef.current.get(item.id);
        if (!file) {
          setBoth(markFailed(queueRef.current, item.id, 'the file is no longer available'));
          continue;
        }
        try {
          const outcome = await runOne(file, controller.signal, item.id);
          setBoth(markDone(queueRef.current, item.id, outcome));
        } catch (error) {
          const message = controller.signal.aborted
            ? 'stopped while this file was generating'
            : (error as Error)?.message || 'generation failed';
          setBoth(markFailed(queueRef.current, item.id, message));
          // A quota or key failure will hit every remaining file the same way, so
          // stopping is kinder than forty identical errors.
          if (/quota|api key|permission|denied/i.test(message) && !halted) {
            halted = true;
            setBoth(cancelPending(queueRef.current));
            setNotice(`Stopped after "${item.sourceName}": ${message}`);
            return;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));

    abortRef.current = null;
    setRunning(false);
  }, [ready, onNeedKey, runOne, parallel]);

  const stop = () => {
    abortRef.current?.abort();
    setBoth(cancelPending(queueRef.current));
    setNotice('Stopped. Files already generated are kept.');
  };

  const downloadAll = () => {
    const entries = queue
      .filter((i) => i.status === 'done' && i.repxContent)
      .map((i) => ({ name: outputName(i), content: i.repxContent }));
    const { bytes, reason } = buildZip(entries);
    if (!bytes) { setNotice(reason); return; }
    // A fresh ArrayBuffer, because the Blob must not alias a view whose buffer
    // the writer may still be sized against.
    const blob = new Blob([bytes.slice()], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'forma-reports.zip';
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${entries.length} file${entries.length === 1 ? '' : 's'} as forma-reports.zip.`);
  };

  const downloadOne = (item: BatchItem) => {
    const blob = new Blob([item.repxContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = outputName(item);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`bp-root${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        if (running || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (running) return;
        // The items are read before anything is awaited; see folderDrop.ts.
        void filesFromDrop(e.dataTransfer.items).then(addFiles);
      }}
    >
      <style>{`
        .bp-root { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; border-radius: 14px; }
        .bp-root.is-dragging { outline: 2px dashed var(--rule-strong, #8a94a3); outline-offset: 4px; background: var(--track, transparent); }
        .bp-at { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; opacity: .85; }
        .bp-at select { font: inherit; font-size: 12px; padding: 2px 4px; border-radius: 8px; border: 1px solid var(--rule-strong, #d7dee7); background: transparent; color: inherit; }
        .bp-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .bp-note { font-size: 12px; line-height: 1.5; opacity: .8; margin: 0; }
        .bp-stats {
          font-family: var(--font-code, monospace); font-size: 10.5px; letter-spacing: .08em;
          text-transform: uppercase; opacity: .65; display: flex; gap: 12px; flex-wrap: wrap;
        }
        .bp-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; min-height: 0; flex: 1; }
        .bp-row {
          display: grid; grid-template-columns: 10px minmax(0, 1fr) auto;
          gap: 4px 10px; align-items: baseline;
          padding: 9px 0; border-bottom: 1px solid var(--rule-soft, #eceff3);
        }
        .bp-dot { width: 7px; height: 7px; border-radius: 50%; align-self: center; }
        .bp-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bp-verdict {
          grid-column: 2 / -1; font-size: 11.5px; opacity: .7; line-height: 1.4;
        }
        .bp-verdict.is-bad { color: var(--bad, #b3261e); opacity: 1; }
        .bp-verdict.is-warn { color: var(--warn, #b45309); opacity: 1; }
        .bp-row-actions { display: flex; gap: 6px; }
        .bp-mini {
          font-family: var(--font-code, monospace); font-size: 10px; letter-spacing: .06em;
          text-transform: uppercase; padding: 2px 7px; border-radius: 999px;
          border: 1px solid var(--rule-strong, #d7dee7); background: transparent;
          color: inherit; cursor: pointer;
        }
        .bp-mini:disabled { opacity: .4; cursor: default; }
        .bp-empty { font-size: 12.5px; line-height: 1.6; opacity: .75; }
      `}</style>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.repx"
        className="wb-hidden"
        onChange={(e) => { addFiles(filesFromPicker(e.target.files ?? [])); e.target.value = ''; }}
      />
      {/* `webkitdirectory` is what lets the picker select a folder: the
          attribute the "does not offer a folder" test holds the copy to. React
          has no typed prop for it, so it goes in as a plain attribute. */}
      <input
        ref={folderRef}
        type="file"
        multiple
        className="wb-hidden"
        {...{ webkitdirectory: '' }}
        onChange={(e) => { addFiles(filesFromPicker(e.target.files ?? [])); e.target.value = ''; }}
      />

      <div className="bp-actions">
        <button className="wb-pill wb-pill--outline" onClick={() => inputRef.current?.click()} disabled={running}>
          Choose files
        </button>
        <button className="wb-pill wb-pill--outline" onClick={() => folderRef.current?.click()} disabled={running}>
          Choose a folder
        </button>
        {summary.pending > 0 && !running && (
          <button className="wb-pill wb-pill--accent" onClick={run}>
            {summary.done + summary.failed > 0 ? 'Continue' : `Generate ${summary.pending}`}
          </button>
        )}
        {running && (
          <button className="wb-pill wb-pill--outline" onClick={stop}>Stop</button>
        )}
        {!running && (summary.failed > 0 || summary.cancelled > 0) && (
          <button className="wb-pill wb-pill--outline" onClick={() => setBoth(retryUnfinished(queueRef.current))}>
            Retry {summary.failed + summary.cancelled}
          </button>
        )}
        {summary.downloadable > 0 && (
          <button className="wb-pill wb-pill--outline" onClick={downloadAll}>
            Download {summary.downloadable} as .zip
          </button>
        )}
        {queue.length > 1 && (
          <label className="bp-at" title="More at once finishes sooner when your key's quota allows it; a free key is safest at one.">
            At a time
            <select value={parallel} disabled={running} onChange={(e) => setParallel(Number(e.target.value))}>
              {BATCH_PARALLEL.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {queue.length > 0 && (
        <div className="bp-stats">
          <span>{summary.done}/{summary.total} done</span>
          {summary.failed > 0 && <span>{summary.failed} failed</span>}
          {summary.withErrors > 0 && <span>{summary.withErrors} with errors</span>}
          {summary.withWarnings > 0 && <span>{summary.withWarnings} with warnings</span>}
        </div>
      )}

      {notice && <p className="bp-note">{notice}</p>}

      {/* The empty state promised a folder twice before the panel could take
          one: "Drop a folder" on a panel with no onDrop handler, then "Choose a
          folder" on an input with `multiple` and not `webkitdirectory`. Since
          2026-11-04 both are true: the panel takes a drop of files or folders
          (folderDrop.ts opens them), and the second input carries
          `webkitdirectory`. The test that pins this copy to the inputs'
          abilities still runs. */}
      {queue.length === 0 ? (
        <p className="bp-empty">
          Choose or drop the screenshots, PDFs or existing <code>.repx</code> files you want
          converted, or a whole folder of them, and each one becomes its own report: one{' '}
          <code>.repx</code> per source document, with the structural audit's verdict beside it,
          downloadable together as a zip.
          <br /><br />
          This is different from attaching several files to the composer, which builds
          <em> one</em> report out of several pages.
        </p>
      ) : (
        <ul className="bp-list">
          {queue.map((item) => {
            const bad = item.status === 'failed' || (item.status === 'done' && item.errors > 0);
            const warn = item.status === 'done' && item.errors === 0 && item.warnings > 0;
            return (
              <li className="bp-row" key={item.id}>
                <span className="bp-dot" style={{ background: STATUS_DOT[item.status] }} />
                <span className="bp-name" title={item.sourceName}>
                  {item.title || item.sourceName}
                </span>
                <span className="bp-row-actions">
                  {item.status === 'done' && item.repxContent && (
                    <>
                      <button className="bp-mini" onClick={() => onOpen(item)}>Open</button>
                      <button className="bp-mini" onClick={() => downloadOne(item)}>.repx</button>
                    </>
                  )}
                </span>
                <span className={`bp-verdict${bad ? ' is-bad' : warn ? ' is-warn' : ''}`}>
                  {verdict(item)}
                  {item.status === 'done' && item.bands > 0 && ` · ${item.bands} bands`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
