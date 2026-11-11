// @vitest-environment jsdom
/**
 * Every way out of Forma in one panel (2026-11-06), as Stitch's Export: the
 * .repx first, the designer beside it, then every format the Preview prints
 * to, each closing the panel as it runs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ExportPanel, { PRINT_FORMATS } from './ExportPanel';

afterEach(cleanup);

describe('ExportPanel', () => {
  it('downloads the .repx from its first row and closes', () => {
    const onRepx = vi.fn();
    const onClose = vi.fn();
    render(<ExportPanel onRepx={onRepx} onDesigner={vi.fn()} onPrint={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /DevExpress report \(\.repx\)/ }));
    expect(onRepx).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('asks the Preview for each print format by its own name', () => {
    const onPrint = vi.fn();
    render(<ExportPanel onRepx={vi.fn()} onDesigner={vi.fn()} onPrint={onPrint} onClose={vi.fn()} />);
    const squash = (s: string) => s.replace(/\s+/g, '');
    for (const [format, label, what] of PRINT_FORMATS) {
      // The whole name, label and line: "PDF" alone also begins "PDF with outline".
      fireEvent.click(screen.getByRole('button', { name: (name) => squash(name) === squash(label + what) }));
      expect(onPrint).toHaveBeenLastCalledWith(format);
    }
    expect(onPrint).toHaveBeenCalledTimes(PRINT_FORMATS.length);
  });

  it('greys the designer for a report with no XML, and closes on Escape', () => {
    const onClose = vi.fn();
    render(<ExportPanel onRepx={vi.fn()} onPrint={vi.fn()} onClose={onClose} />);
    const designer = screen.getByRole('button', { name: /Open in the DevExpress designer/ }) as HTMLButtonElement;
    expect(designer.disabled).toBe(true);
    // In plain words, not the file's insides (the full audit's PX-22, 2026-11-11).
    expect(designer.textContent).toContain('There is no report file to open yet');
    expect(designer.textContent).not.toMatch(/XML/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // PR-17 (BW2, 2026-11-11): no file is a greyed row that says why, not a click answered by a notice.
  it('greys the .repx row when there is no file, says why, and starts the keyboard on the first row that runs', () => {
    const onPrint = vi.fn();
    render(<ExportPanel onPrint={onPrint} onClose={vi.fn()} />);
    const repx = screen.getByRole('button', { name: /DevExpress report \(\.repx\)/ }) as HTMLButtonElement;
    expect(repx.disabled).toBe(true);
    expect(repx.textContent).toContain('There is no report file yet');
    expect(document.activeElement?.textContent).toMatch(/^PDF/);
    cleanup();
    render(<ExportPanel onRepx={vi.fn()} onPrint={onPrint} onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: /DevExpress report \(\.repx\)/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement?.textContent).toMatch(/DevExpress report/);
  });

  /*
   * "Safe for spreadsheets" (SE-18), read from lib/csvSafety.ts since
   * 2026-11-11 so this panel no longer loads the CSV writer: off at first,
   * kept in this browser once set, and read back by the next panel.
   */
  it('keeps "Safe for spreadsheets" in this browser once it is switched on or off', () => {
    localStorage.removeItem('forma.csvSafeForSpreadsheets');
    const props = { onRepx: vi.fn(), onPrint: vi.fn(), onClose: vi.fn() };
    const { unmount } = render(<ExportPanel {...props} />);
    const toggle = () => screen.getByRole('switch', { name: /Safe for spreadsheets/ }) as HTMLInputElement;
    expect(toggle().checked).toBe(false);
    fireEvent.click(toggle());
    expect(toggle().checked).toBe(true);
    expect(localStorage.getItem('forma.csvSafeForSpreadsheets')).toBe('1');
    // The next panel opens with it on, and switching it off forgets it.
    unmount();
    render(<ExportPanel {...props} />);
    expect(toggle().checked).toBe(true);
    fireEvent.click(toggle());
    expect(toggle().checked).toBe(false);
    expect(localStorage.getItem('forma.csvSafeForSpreadsheets')).toBeNull();
    // Switching it is not choosing a row: the panel stays open.
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
