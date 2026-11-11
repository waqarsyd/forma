/**
 * Every way out of Forma in one panel (2026-11-06), as Google Stitch's Export
 * floats at the right of its canvas: the report file first, the DevExpress
 * designer beside it, then each format the Preview prints to. A print format
 * opens Preview and asks it for the export, as the chat's export tool does
 * (`exportRequest`), because only the Preview has the pages laid out. The
 * workspace's Preview draws no export buttons of its own (2026-11-06); a
 * shared report's page keeps them. Escape, a click elsewhere or the close
 * button shuts it; choosing a row runs it and shuts it. See *The
 * conversation floats over the report* in docs/notes/app-shell.md.
 */
import { useEffect, useRef, useState } from 'react';
import { IconClose, IconDownload, IconExternal } from './landing/icons';
import { csvSafetyPreferred, preferCsvSafety } from '../lib/csvExport';
import './overlays.css';
// For the switch's look, the one Settings uses (`.wb-set-switch`).
import './dialogs.css';
import { useLayer } from './useLayer';
import { useReturnFocus } from './useMenuKeys';

/** What the Preview can be asked to export; 'pdf-outline' is the PDF Forma writes itself. */
export type PrintFormat = 'pdf' | 'pdf-outline' | 'xlsx' | 'csv' | 'docx' | 'rtf' | 'html' | 'png';

export const PRINT_FORMATS: [PrintFormat, string, string][] = [
  ['pdf', 'PDF', 'As it prints, through the browser'],
  ['pdf-outline', 'PDF with outline', 'Written by Forma, with the bookmarks as its outline'],
  ['xlsx', 'Excel (.xlsx)', 'The data in a workbook'],
  ['csv', 'CSV', 'The data as plain rows'],
  ['docx', 'Word (.docx)', 'The pages as a document'],
  ['rtf', 'RTF', 'The pages as rich text'],
  ['html', 'HTML', 'One page for a browser'],
  ['png', 'Image (.png)', 'The pages as a picture'],
];

interface Props {
  /**
   * Absent when the report has no XML (2026-11-11, the full audit's PR-17 and
   * BW2): the row is greyed and says why, as the designer's is. It used to
   * run and leave `downloadDesign`'s notice to say there was nothing to save.
   */
  onRepx?: () => void;
  /** Absent when the report has no XML to open; it starts the companion when that is not running. */
  onDesigner?: () => void;
  onPrint: (format: PrintFormat) => void;
  onClose: () => void;
}

export default function ExportPanel({ onRepx, onDesigner, onPrint, onClose }: Props) {
  const box = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayer(onClose, true, 'export');
  // Focus back to Export when it closes (2026-11-06).
  useReturnFocus(box);
  // Once, as it opens (2026-11-06). The focus sat in an effect that re-ran
  // with every new `onClose`, which App passes inline, so each render of the
  // workspace (a toast, the tip, the autosave) took the focus back to the
  // first row: Tab to Excel, then Enter, downloaded the .repx.
  useEffect(() => {
    // The first row that can run: the .repx's is greyed when there is no file (BW2).
    box.current?.querySelector<HTMLButtonElement>('.wb-export-row:not(:disabled)')?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('[data-export-toggle]')) closeRef.current();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, []);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  // CSV safe for spreadsheets (2026-11-11, the full audit's SE-18): off by
  // default, so the file stays DevExpress's; kept in this browser once set.
  const [safeCsv, setSafeCsv] = useState(csvSafetyPreferred);
  const toggleSafeCsv = (on: boolean) => {
    setSafeCsv(on);
    preferCsvSafety(on);
  };
  return (
    <section className="wb-export" ref={box} role="dialog" aria-label="Export">
      <div className="wb-export-head">
        <h2>Export</h2>
        <button type="button" className="wb-export-close" aria-label="Close" onClick={onClose}>
          <IconClose size={14} />
        </button>
      </div>
      <h3>The report</h3>
      <button type="button" className="wb-export-row" disabled={!onRepx} onClick={onRepx ? run(onRepx) : undefined}>
        <IconDownload size={15} />
        <span>
          <b>DevExpress report (.repx)</b>
          <small>{onRepx ? 'The file the designer opens' : 'There is no report file yet. Send the request again to make one'}</small>
        </span>
      </button>
      <button type="button" className="wb-export-row" disabled={!onDesigner} onClick={onDesigner ? run(onDesigner) : undefined}>
        <IconExternal size={15} />
        <span>
          <b>Open in the DevExpress designer</b>
          {/* "no DevExpress XML" named the file's insides (the full audit's PX-22, 2026-11-11). */}
          <small>{onDesigner ? 'The real designer, on your PC, through Forma Designer' : 'There is no report file to open yet'}</small>
        </span>
      </button>
      <h3>As it prints</h3>
      <div className="wb-export-grid">
        {PRINT_FORMATS.map(([format, label, what]) => (
          <button key={format} type="button" className="wb-export-row" onClick={run(() => onPrint(format))}>
            <span>
              <b>{label}</b>
              <small>{what}</small>
            </span>
          </button>
        ))}
      </div>
      <label className="wb-export-row">
        <input type="checkbox" role="switch" className="wb-set-switch" checked={safeCsv} onChange={(e) => toggleSafeCsv(e.target.checked)} />
        <span>
          <b>Safe for spreadsheets</b>
          <small>In a CSV, a cell that starts like a formula is kept as text</small>
        </span>
      </label>
    </section>
  );
}
