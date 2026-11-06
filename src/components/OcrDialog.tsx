/**
 * Read the text of the attached images and scans with OCR, and show what was
 * detected before anything is written (2026-11-01).
 *
 * The owner asked for a preview of the detected layout before a .repx is
 * generated, so this dialog is that step: each page is read in turn, in the
 * browser, and drawn on its report page with every text's box over the
 * source. A box is green when every word in it was read with confidence, red
 * when one was not, and dashed where the reading was set aside as a picture.
 * The red ones are listed, to be checked against the source.
 *
 * **Build .repx** then writes the report straight from the layout, with no
 * model involved, after the app's own checks: `layoutToRepx` and
 * `validateOcrRepx` in ocrRepx.ts. It fills every pane a generated report does.
 *
 * Since 2026-11-01 this is the review the chat box opens from an image's
 * chip. The chat box reads each page as it is attached (`lib/ocrAttach.ts`)
 * and hands the pages over in `preread`; their text goes with the message on
 * its own, so the "Use for generation" button this dialog had is gone.
 *
 * Nothing here leaves the browser. The engine is loaded from this site's own
 * `/ocr/` the first time, about 7 MB, and kept for the next run.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconClose } from './landing/icons';
import { useFocusTrap } from './useFocusTrap';
import type { PreviewMeta } from '../lib/attachments';
import { recognizePage, type OcrPage } from '../lib/ocr';
import { detectLayout, placementFor, type DetectedLayout, type DetectedText } from '../lib/ocrLayout';
import { layoutToRepx, layoutToReport, ocrSummary, reportNameFor, validateOcrRepx } from '../lib/ocrRepx';
import { imageDpi, pageForImage } from '../lib/reportGeometry';
import type { ReportLayout } from '../lib/reportTypes';

export interface OcrPageSource {
  /** The page image as attached: a data URL. */
  src: string;
  meta: PreviewMeta;
}

/** A report built from OCR alone, for every pane a generated one fills. */
export interface OcrBuiltReport {
  title: string;
  repxContent: string;
  layout: ReportLayout;
  markdown: string;
  flagged: number;
}

export interface OcrDialogProps {
  pages: OcrPageSource[];
  /** The report unit and paper the configuration names. */
  unit: string;
  pageSize: string;
  onBuild: (report: OcrBuiltReport) => void;
  onClose: () => void;
  /**
   * Pages the chat box has read already (2026-11-01), by index into `pages`;
   * those are shown, not read again.
   */
  preread?: readonly (OcrPage | null | undefined)[];
}

/** A page left unread by Stop. */
const STOPPED = 'stopped';

type PageRun =
  | { status: 'waiting' }
  | { status: 'reading'; stage: string; progress: number }
  | { status: 'done'; ocr: OcrPage }
  | { status: 'failed'; error: string };

/** What Tesseract's progress stages mean to someone waiting for them. */
function stageLabel(stage: string): string {
  if (/core|initializ|traineddata|language|api/i.test(stage)) return 'Loading the OCR engine';
  if (/recogniz/i.test(stage)) return 'Reading';
  return 'Preparing';
}

const pageName = (meta: PreviewMeta) => (meta.page ? `${meta.file}, page ${meta.page}` : meta.file);

/* `reportNameFor` moved to lib/ocrRepx.ts on 2026-11-02; the re-export kept
   here for "this dialog's callers" had none but its test, and went on
   2026-11-06 (the workspace audit) with the test moving beside the function. */

export default function OcrDialog({ pages, unit, pageSize, onBuild, onClose, preread }: OcrDialogProps) {
  const initialRuns = (): PageRun[] => pages.map((_, i) => (preread?.[i] ? { status: 'done', ocr: preread[i]! } : { status: 'waiting' }));
  const [runs, setRuns] = useState<PageRun[]>(initialRuns);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState(0);
  const [focus, setFocus] = useState<DetectedText | null>(null);
  const [dropFlagged, setDropFlagged] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const controller = useRef<AbortController | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  // One page at a time: the engine is one worker, and a page is seconds.
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const set = (i: number, run: PageRun) => setRuns((all) => all.map((r, k) => (k === i ? run : r)));
    void (async () => {
      for (let i = 0; i < pages.length; i++) {
        if (abort.signal.aborted) return;
        if (preread?.[i]) continue;
        set(i, { status: 'reading', stage: '', progress: 0 });
        try {
          const read = await recognizePage(pages[i].src, null, {
            signal: abort.signal,
            onProgress: (stage, progress) => set(i, { status: 'reading', stage, progress }),
          });
          const points = pages[i].meta.pagePoints;
          // The resolution is the image's own width against its page's, measured
          // here because a large page is resized on its way in.
          set(i, { status: 'done', ocr: { ...read, dpi: points ? imageDpi(read.width, points.width) : null } });
        } catch (err) {
          if (abort.signal.aborted) return;
          set(i, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => abort.abort();
  }, [pages, attempt]);

  const read = useMemo(
    () => runs.flatMap((run, index) => (run.status === 'done' ? [{ index, ocr: run.ocr }] : [])),
    [runs],
  );
  const finished = runs.every((r) => r.status === 'done' || r.status === 'failed');
  const failed = runs.filter((r) => r.status === 'failed').length;

  const layout: DetectedLayout | null = useMemo(
    () =>
      read.length
        ? detectLayout(read.map(({ ocr }) => ({ ocr, page: pageForImage(ocr, unit, pageSize) })), { unit })
        : null,
    [read, unit, pageSize],
  );

  const flagged = useMemo(
    () =>
      layout
        ? layout.pages.flatMap((p, k) =>
            [...p.labels, ...p.tables.flatMap((t) => t.rows.flatMap((r) => r.cells))]
              .filter((t): t is DetectedText => !!t && t.flagged)
              .map((t) => ({ t, k })),
          )
        : [],
    [layout],
  );

  // Stopped, the pages not read are finished as stopped (2026-11-06, the
  // workspace audit): the page being read stayed "reading" and the rest
  // "waiting", so Build stayed disabled, Stop did nothing more and Try again
  // never showed, and the only way out was to close the dialog.
  const stop = () => {
    controller.current?.abort();
    setRuns((all) => all.map((r) => (r.status === 'done' || r.status === 'failed' ? r : { status: 'failed', error: STOPPED })));
  };
  const retry = () => {
    setRuns(initialRuns());
    setProblems(null);
    setAttempt((a) => a + 1);
  };

  const title = pages[0] ? pages[0].meta.file.replace(/\.[^.]+$/, '') : 'Report read by OCR';

  const build = (force = false) => {
    if (!layout) return;
    const repxContent = layoutToRepx(layout, { name: reportNameFor(pages[0]?.meta.file ?? 'OcrReport'), dropFlagged });
    const check = validateOcrRepx(repxContent);
    if (!check.ok && !force) {
      setProblems(check.problems);
      return;
    }
    onBuild({
      title,
      repxContent,
      layout: layoutToReport(layout, { title, dropFlagged }),
      markdown: ocrSummary(layout, { title, dropFlagged }),
      flagged: dropFlagged ? 0 : layout.flagged,
    });
  };


  const shownRead = read.findIndex((r) => r.index === shown);
  const shownPage = layout && shownRead >= 0 ? layout.pages[shownRead] : null;
  const shownOcr = shownRead >= 0 ? read[shownRead].ocr : null;
  const counts = layout
    ? {
        labels: layout.pages.reduce((s, p) => s + p.labels.length, 0),
        tables: layout.pages.reduce((s, p) => s + p.tables.length, 0),
      }
    : null;

  return (
    <div className="wb-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wb-modal wb-ocr wb-reg-marks" role="dialog" aria-modal="true" aria-labelledby="ocr-title" ref={dialogRef} tabIndex={-1}>
        <div className="wb-modal-head">
          <h2 id="ocr-title">Read text with OCR</h2>
          <button className="wb-pill wb-pill--round" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>

        <div className="wb-modal-body">
          <div className="wb-modal-col">
            {pages.length > 1 && (
              <div className="wb-chips" role="tablist" aria-label="Pages">
                {pages.map((p, i) => (
                  <button
                    key={`${p.meta.uploadId}-${p.meta.page ?? 0}-${i}`}
                    role="tab"
                    aria-selected={shown === i}
                    className={`wb-pill ${shown === i ? 'wb-pill--accent' : 'wb-pill--outline'}`}
                    onClick={() => { setShown(i); setFocus(null); }}
                  >
                    {p.meta.page ? `Page ${p.meta.page}` : `Image ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            {shownPage && shownOcr ? (
              <div className="wb-ocr-scroll">
                <DetectedSheet page={shownPage} ocr={shownOcr} src={pages[shown].src} unit={unit} focus={focus} />
              </div>
            ) : (
              <div className="wb-ocr-wait" aria-live="polite">
                {runs[shown]?.status === 'failed' ? `This page could not be read: ${(runs[shown] as { error: string }).error}` : 'The detected layout appears here as each page is read.'}
              </div>
            )}
            <p className="wb-ocr-legend">
              <span className="wb-ocr-key" /> read with confidence
              <span className="wb-ocr-key is-flagged" /> a word below 60
              <span className="wb-ocr-key is-ignored" /> set aside as a picture
              <span className="wb-ocr-key is-table" /> a table
            </p>
          </div>

          <div className="wb-modal-col">
            <div className="wb-fset">
              <div className="wb-eyebrow"><b>x 001</b>Reading<span className="wb-fade" /></div>
              <ol className="wb-ocr-runs" aria-live="polite">
                {pages.map((p, i) => {
                  const run = runs[i];
                  const pct = run.status === 'reading' ? Math.round(run.progress * 100) : run.status === 'done' ? 100 : 0;
                  return (
                    <li key={`${p.meta.uploadId}-${p.meta.page ?? 0}-${i}`} className={run.status === 'failed' ? 'is-failed' : ''}>
                      <span className="wb-ocr-run-name">{pageName(p.meta)}</span>
                      <span className="wb-ocr-run-state">
                        {run.status === 'waiting' && 'Waiting'}
                        {run.status === 'reading' && `${stageLabel(run.stage)} ${pct}%`}
                        {run.status === 'done' && `${run.ocr.lines.length} lines`}
                        {run.status === 'failed' && 'Could not be read'}
                      </span>
                      <span className="wb-ocr-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                    </li>
                  );
                })}
              </ol>
              {!finished && <p className="wb-hint">The first run loads the OCR engine from this site, about 7 MB, once. Nothing leaves your browser.</p>}
              {finished && failed > 0 && (
                <p className="wb-hint" role="alert">
                  {runs.some((r) => r.status === 'failed' && r.error === STOPPED)
                    ? `Stopped: ${failed} of ${pages.length} ${pages.length === 1 ? 'page was' : 'pages were'} not read. `
                    : failed === pages.length ? 'No page could be read. ' : `${failed} of ${pages.length} pages could not be read and are left out. `}
                  <button className="wb-ocr-link" type="button" onClick={retry}>Try again</button>
                </p>
              )}
            </div>

            {layout && counts && (
              <div className="wb-fset">
                <div className="wb-eyebrow"><b>x 002</b>Detected<span className="wb-fade" /></div>
                <p className="wb-ocr-counts">
                  {counts.labels} labels · {counts.tables} tables · <b className={layout.flagged ? 'is-flagged' : ''}>{layout.flagged} low confidence</b>
                  {layout.ignored > 0 && <> · {layout.ignored} set aside</>}
                </p>
                {flagged.length > 0 ? (
                  <>
                    <p className="wb-hint">Check these against the source. Each is named lowConfidence… in the report, so the designer finds it.</p>
                    <ul className="wb-ocr-list">
                      {flagged.map(({ t, k }, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className={focus === t ? 'is-focus' : ''}
                            onClick={() => { setShown(read[k].index); setFocus(t); }}
                          >
                            <span className="wb-ocr-list-text">{t.text}</span>
                            <span className="wb-ocr-list-meta">{pages.length > 1 ? `p${pages[read[k].index].meta.page ?? read[k].index + 1} · ` : ''}{Math.round(t.confidence)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <label className="wb-checkrow">
                      <input type="checkbox" checked={dropFlagged} onChange={(e) => setDropFlagged(e.target.checked)} />
                      Leave low-confidence text out of the report
                    </label>
                  </>
                ) : (
                  <p className="wb-hint">Every word was read with confidence.</p>
                )}
                {problems && (
                  <div className="wb-ocr-problems" role="alert">
                    <p>The report did not pass the app's checks:</p>
                    <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    <button className="wb-ocr-link" type="button" onClick={() => build(true)}>Build it anyway</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="wb-modal-foot">
          {!finished ? (
            <button className="wb-pill" type="button" onClick={stop}>Stop</button>
          ) : (
            <button className="wb-pill" type="button" onClick={onClose}>Close</button>
          )}
          <button
            className="wb-pill wb-pill--accent"
            type="button"
            onClick={() => build()}
            disabled={!finished || !layout}
            title="Write the report from the detected layout, with no model involved"
          >
            Build .repx
          </button>
        </div>
      </div>
    </div>
  );
}

/** One page as detected: its image on the report page, with every text's box over it. */
function DetectedSheet({ page, ocr, src, unit, focus }: { page: DetectedLayout['pages'][number]; ocr: OcrPage; src: string; unit: string; focus: DetectedText | null }) {
  const WIDTH = 520;
  const s = WIDTH / page.width;
  const at = placementFor(ocr, page, unit);
  const box = (b: { x: number; y: number; w: number; h: number }) => ({ left: b.x * s, top: b.y * s, width: Math.max(1, b.w * s), height: Math.max(1, b.h * s) });
  const tip = (t: DetectedText) => `${t.text} (${Math.round(t.confidence)})`;
  const cells = page.tables.flatMap((t) => t.rows.flatMap((r) => r.cells)).filter((c): c is DetectedText => !!c);
  return (
    <div className="wb-ocr-sheet" style={{ width: WIDTH, height: page.height * s }} role="img" aria-label={`Detected layout: ${page.labels.length} labels, ${page.tables.length} tables`}>
      <img src={src} alt="" style={{ left: at.left * s, top: at.top * s, width: ocr.width * at.unitsPerPixel * s }} />
      <span
        className="wb-ocr-margin"
        style={box({ x: page.margins.left, y: page.margins.top, w: page.width - page.margins.left - page.margins.right, h: page.height - page.margins.top - page.margins.bottom })}
      />
      {page.tables.map((t, i) => {
        const w = t.columns.reduce((a, c) => a + c, 0);
        const h = t.rows.reduce((a, r) => a + r.h, 0);
        let x = t.x;
        return (
          <span key={`t${i}`} className="wb-ocr-table" style={box({ x: t.x, y: t.y, w, h })}>
            {t.columns.slice(0, -1).map((c, k) => {
              x += c;
              return <span key={k} className="wb-ocr-col" style={{ left: (x - t.x) * s }} />;
            })}
          </span>
        );
      })}
      {[...page.labels, ...cells].map((t, i) => (
        <span key={`b${i}`} className={`wb-ocr-box${t.flagged ? ' is-flagged' : ''}${focus === t ? ' is-focus' : ''}`} style={box(t.ink)} title={tip(t)} />
      ))}
      {page.ignored.map((t, i) => (
        <span key={`i${i}`} className="wb-ocr-box is-ignored" style={box(t.ink)} title={`Set aside: ${tip(t)}`} />
      ))}
    </div>
  );
}
