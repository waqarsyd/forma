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
 * REPX pane's audit uses for a single report (the status bar's until it went
 * on 2026-11-04). `batchQueue.ts` owns those states; this
 * file owns the running of them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createQueue, appendQueue, keepsWork, nextPending, markRunning, markDone, markFailed,
  cancelPending, retryUnfinished, summarise, verdict, outputName, updateItem,
  BATCH_PARALLEL, type BatchItem, type BatchOutcome,
} from '../lib/batchQueue';
import { crystalNote, filesFromDrop, filesFromPicker, forBatch, MAX_BATCH_FILES, type GivenFile } from '../lib/folderDrop';
import { buildZip } from '../lib/zip';
import { clearKept, keepFiles, keepItems, keepQueue, keptNote, readKept, restoredQueue, stopsTheBatch, type KeptChange } from '../lib/batchCheckpoint';
import { isLimit } from '../lib/fallbackChain';
import { batchReadyNote } from '../lib/jobPlan';
import { saveBlob } from '../lib/download';

interface Props {
  /**
   * Runs one file through the same steps a single report is made by
   * (2026-11-11, the full audit's PL-15). Supplied by App.
   *
   * `words` is what the request asked of each file beyond making it, empty for
   * files added here. `BatchOutcome` carries only what a row shows, because
   * `batchQueue.ts` is a pure module and has no business knowing what a
   * workspace result looks like; "Open" reads the rest off the row's REPX
   * (`resultFromKept`).
   */
  runOne: (file: File, signal: AbortSignal, id: string, words: string) => Promise<BatchOutcome>;
  /** Loads a finished item into the workspace. */
  onOpen: (item: BatchItem) => void;
  /** False when there is no API key; the panel explains rather than failing. */
  ready: boolean;
  onNeedKey: () => void;
  /**
   * Files a plan in the chat sent here, each its own report, started at once
   * (2026-11-10, batch AG item 22), with what else the request asked of each
   * (`words`, PL-15).
   */
  incoming?: { files: File[]; id: number; words?: string } | null;
  /** What to say in the thread once the files the chat sent are all made or given up on (PL-14). */
  onFinished?: (note: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  pending: 'var(--ink-faint, #7a8592)',
  running: 'var(--warn, #b45309)',
  done: 'var(--ok-ink, #1f6f49)',
  failed: 'var(--bad, #b3261e)',
  cancelled: 'var(--ink-faint, #7a8592)',
};

export default function BatchPanel({ runOne, onOpen, ready, onNeedKey, incoming, onFinished }: Props) {
  const [queue, setQueue] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  /** The same, for the hand-over from the chat, which must not read a stale render's. */
  const runningRef = useRef(false);
  /** Files the chat sent while a batch ran, or before the kept one was read: added once it is (PL-14). */
  const pendingIncoming = useRef<{ files: File[]; words: string }[]>([]);
  /** Whether the batch this browser kept has been read, so files handed over never replace it unread. */
  const [keptRead, setKeptRead] = useState(false);
  /** The items the chat sent, whose outcome the thread is told (PL-14). */
  const fromChat = useRef<Set<string>>(new Set());
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

  /*
   * Each change kept in this browser, so the batch carries on after a limit
   * or a reload (batch AG item 23): only the items that changed, each its own
   * record, and a REPX once, when its item is done (2026-11-11, the full
   * audit's PL-13). The whole queue, every REPX in it, was written on every
   * change. `replace` is a new batch in place of the kept one.
   */
  const setBoth = (next: BatchItem[], replace = false) => {
    const before = new Map(queueRef.current.map((item) => [item.id, item]));
    queueRef.current = next;
    setQueue(next);
    if (replace) {
      void keepQueue(next);
      return;
    }
    const changes: KeptChange[] = next.flatMap((item, order) => {
      const was = before.get(item.id);
      if (was === item) return [];
      return [{ item, order, repx: item.status === 'done' && item.repxContent !== '' && was?.repxContent !== item.repxContent }];
    });
    void keepItems(changes);
  };

  // The batch this browser kept, opened again when the panel has none of its own.
  useEffect(() => {
    let gone = false;
    void readKept().then((kept) => {
      if (gone) return;
      if (kept && !queueRef.current.length) {
        filesRef.current = kept.files;
        // Set as kept first, so only what opening changes is written again;
        // a batch kept in the old shape is written in the new one (PL-13).
        if (!kept.legacy) queueRef.current = kept.items;
        setBoth(restoredQueue(kept.items), kept.legacy);
        setNotice(keptNote(kept.items, kept.savedAt));
      }
      setKeptRead(true);
    });
    return () => {
      gone = true;
    };
  }, []);

  const clear = () => {
    filesRef.current = new Map();
    queueRef.current = [];
    fromChat.current = new Set();
    setQueue([]);
    setNotice('');
    void clearKept();
  };

  const summary = summarise(queue);

  /**
   * Files from the picker, the folder picker, a drop or the chat, as the
   * queue. What the batch cannot take (a spreadsheet, a hidden file) is left
   * out and counted, a Crystal Reports file with the way in (2026-11-11), and
   * a folder's files queue in path order.
   *
   * A batch with work left (a file not made, a report never downloaded) is
   * added to rather than replaced (2026-11-11, the full audit's PL-14): the
   * chat's hand-over replaced it, files and all, without a word.
   */
  const addFiles = (given: readonly GivenFile[], words = '', chat = false): boolean => {
    if (!given.length || runningRef.current) return false;
    const { files, skipped, crystal, truncated } = forBatch(given);
    const crystalSaid = crystal > 0 ? ` ${crystalNote(crystal)}` : '';
    if (!files.length) {
      setNotice(`Nothing here the batch can take: it reads images, PDFs, .repx files and SSRS reports.${crystalSaid}`);
      return false;
    }
    const join = keepsWork(queueRef.current);
    const paths = files.map((f) => f.path);
    const next = join ? appendQueue(queueRef.current, paths, words) : createQueue(paths, words);
    const added = next.slice(next.length - files.length);
    const addedFiles = new Map(added.map((item, i) => [item.id, files[i].file]));
    filesRef.current = join ? new Map([...filesRef.current, ...addedFiles]) : addedFiles;
    if (!join) fromChat.current = new Set();
    if (chat) for (const item of added) fromChat.current.add(item.id);
    void keepFiles(addedFiles, !join);
    setBoth(next, !join);
    const other = skipped - crystal;
    const left = [
      other > 0 ? `${other} other file${other === 1 ? '' : 's'} left out` : '',
      truncated ? `only the first ${MAX_BATCH_FILES} taken` : '',
    ].filter(Boolean);
    const count = `${files.length} file${files.length === 1 ? '' : 's'}`;
    const what = chat
      ? `${count} from the chat${join ? ', after the ones already here' : ''}`
      : `${count} ${join ? 'added after the ones already here' : 'ready'}`;
    setNotice(`${what}${left.length ? ` (${left.join('; ')})` : ''}.${chat ? '' : ' Nothing is sent until you start.'}${crystalSaid}`);
    return true;
  };

  const run = useCallback(async () => {
    if (!ready) { onNeedKey(); return; }
    runningRef.current = true;
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
          const outcome = await runOne(file, controller.signal, item.id, item.words ?? '');
          setBoth(markDone(queueRef.current, item.id, outcome));
        } catch (error) {
          const message = controller.signal.aborted
            ? 'stopped while this file was generating'
            : (error as Error)?.message || 'generation failed';
          setBoth(markFailed(queueRef.current, item.id, message));
          // A limit or a key failure will hit every remaining file the same way, so
          // stopping is kinder than forty identical errors. A limit is a pause:
          // the batch is kept, and Retry carries on from here (batch AG item 23).
          // The daily allowance's words name no quota, and it went on until 2026-11-10.
          const stops = controller.signal.aborted ? null : stopsTheBatch(message, isLimit(error));
          if (stops && !halted) {
            halted = true;
            setBoth(cancelPending(queueRef.current));
            setNotice(
              stops === 'limit'
                ? `Paused at a limit after "${item.sourceName}": ${message} The batch is kept in this browser; Retry carries on from here, with another AI you set up or once the limit resets.`
                : `Stopped after "${item.sourceName}": ${message}`,
            );
            return;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));

    // The thread is told once every file the chat sent is made or given up
    // on (PL-14): the request was answered "in Batch", and ended there.
    const asked = queueRef.current.filter((item) => fromChat.current.has(item.id));
    if (asked.length && asked.every((item) => item.status !== 'pending' && item.status !== 'running')) {
      fromChat.current = new Set();
      onFinished?.(batchReadyNote(asked));
    }

    abortRef.current = null;
    runningRef.current = false;
    setRunning(false);
  }, [ready, onNeedKey, runOne, parallel, onFinished]);

  /*
   * Files a plan in the chat sent here (batch AG item 22): queued as any are,
   * and started. Never lost (2026-11-11, the full audit's PL-14): a hand-over
   * while a batch ran was dropped, and the plan still said it had started;
   * now it waits for the run, and for the kept batch to be read, and goes in.
   */
  const startNow = useRef(false);
  useEffect(() => {
    if (!incoming?.files.length) return;
    pendingIncoming.current.push({ files: incoming.files, words: incoming.words ?? '' });
    // Once for each hand-over, by its id.
  }, [incoming?.id]);
  useEffect(() => {
    if (running || !keptRead || !pendingIncoming.current.length) return;
    for (const handed of pendingIncoming.current.splice(0)) {
      if (addFiles(handed.files.map((file) => ({ file, path: file.name })), handed.words, true)) startNow.current = true;
    }
  }, [incoming?.id, running, keptRead]);
  useEffect(() => {
    if (!startNow.current || running || !queue.length) return;
    startNow.current = false;
    void run();
  }, [queue, running, run]);

  // Leaving the workspace stops a batch (2026-11-06, the workspace audit).
  // The panel stays mounted while its column is hidden, so this is only the
  // workspace going (the logo, a marketing page), after which the workers
  // went on spending the key's quota for a queue nobody could see.
  useEffect(() => () => abortRef.current?.abort(), []);

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
    // the writer may still be sized against. Through lib/download.ts
    // (2026-11-11, the full audit's PR-17): a link never put in the page, its
    // address let go at once, saved nothing in some browsers.
    saveBlob('forma-reports.zip', new Blob([bytes.slice()], { type: 'application/zip' }));
    // Downloaded, a batch may be replaced by the next (PL-14).
    setBoth(queueRef.current.map((i) => (i.status === 'done' && i.repxContent && !i.downloaded ? { ...i, downloaded: true } : i)));
    setNotice(`Downloaded ${entries.length} file${entries.length === 1 ? '' : 's'} as forma-reports.zip.`);
  };

  const downloadOne = (item: BatchItem) => {
    saveBlob(outputName(item), new Blob([item.repxContent], { type: 'application/xml' }));
    if (!item.downloaded) setBoth(updateItem(queueRef.current, item.id, { downloaded: true }));
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
        // The batch's, not the chat box's as well (2026-11-07, agent audit item 26).
        e.stopPropagation();
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
        // .frx since 2026-11-11 (the re-audit's R4-03): folderDrop takes it and
        // the intake converts it, so the picker offers it as a drop does.
        accept="image/*,application/pdf,.repx,.rdl,.rdlc,.frx,.rpt"
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
        {!running && queue.length > 0 && (
          <button className="wb-pill wb-pill--outline" onClick={clear} title="Removes this batch, and the copy this browser keeps of it">
            Clear
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
          <code>.repx</code> per source document, with a word beside it on whether it came out
          clean, downloadable together as a zip.
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
