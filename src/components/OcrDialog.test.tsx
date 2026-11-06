// @vitest-environment jsdom
/**
 * The OCR dialog, with the engine replaced: what it shows once pages are read,
 * and what it hands up. The engine itself is measured in a real browser, as
 * the OCR section of docs/notes/app-shell.md records; what is pinned here is
 * the contract with App.tsx: pages read one at a time, a failed page left out
 * and said so, Stop aborting the run, low-confidence text listed and either
 * named or left out, and a report built only after the app's own checks.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { OcrLine, OcrPage } from '../lib/ocr';

const recognizePage = vi.fn();
vi.mock('../lib/ocr', () => ({ recognizePage: (...args: unknown[]) => recognizePage(...args) }));

import OcrDialog, { type OcrPageSource } from './OcrDialog';

/** A line of words, each `[text, x0, x1, confidence]`, nine pixels of ink from `y`. */
function line(y: number, ...words: [string, number, number, number?][]): OcrLine {
  const ws = words.map(([text, x0, x1, confidence = 95]) => ({ text, box: { x0, y0: y, x1, y1: y + 9 }, confidence }));
  return {
    text: ws.map((w) => w.text).join(' '),
    box: { x0: ws[0].box.x0, y0: y, x1: ws[ws.length - 1].box.x1, y1: y + 9 },
    confidence: Math.min(...ws.map((w) => w.confidence)),
    words: ws,
  };
}

/** A Letter page rendered at 100 dpi: a pixel is a hundredth of an inch. */
const scan: OcrPage = {
  width: 850,
  height: 1100,
  dpi: null,
  lines: [
    line(100, ['Invoice', 60, 110], ['42', 114, 130]),
    line(140, ['Smudge', 400, 450, 30]),
    line(300, ['Item', 60, 90], ['Qty', 300, 325], ['Price', 450, 490]),
    line(320, ['Chai', 60, 88], ['12', 305, 320], ['18.00', 450, 492]),
  ],
};

const page = (n?: number): OcrPageSource => ({
  src: 'data:image/png;base64,AAAA',
  meta: { uploadId: 'u1', file: 'invoice scan.pdf', page: n, pagePoints: n ? { width: 612, height: 792 } : undefined },
});

const draw = (pages: OcrPageSource[] = [page()]) => {
  const onBuild = vi.fn();
  const onClose = vi.fn();
  const view = render(<OcrDialog pages={pages} unit="HundredthsOfAnInch" pageSize="Letter" onBuild={onBuild} onClose={onClose} />);
  return { onBuild, onClose, ...view };
};

const button = (name: string) => screen.getByText(name) as HTMLButtonElement;
const ready = () => waitFor(() => expect(button('Build .repx').disabled).toBe(false));

// Braces matter: a function returned from beforeEach is run as its teardown.
beforeEach(() => {
  recognizePage.mockReset();
});
afterEach(cleanup);

describe('the OCR dialog', () => {
  it('reads each page, then shows what it found, the unsure text listed', async () => {
    recognizePage.mockResolvedValue(scan);
    const { container } = draw();
    expect(button('Build .repx').disabled).toBe(true);
    await ready();
    expect(recognizePage).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.wb-ocr-counts')?.textContent).toBe('2 labels · 1 tables · 1 low confidence');
    expect([...container.querySelectorAll('.wb-ocr-list-text')].map((e) => e.textContent)).toEqual(['Smudge']);
    // A box for every label and cell, the unsure one marked.
    expect(container.querySelectorAll('.wb-ocr-sheet .wb-ocr-box')).toHaveLength(8);
    expect(container.querySelectorAll('.wb-ocr-sheet .wb-ocr-box.is-flagged')).toHaveLength(1);
    expect(container.querySelectorAll('.wb-ocr-sheet .wb-ocr-table')).toHaveLength(1);
  });

  it('builds the report straight from the layout, unsure text named, or left out', async () => {
    recognizePage.mockResolvedValue(scan);
    const { onBuild } = draw();
    await ready();
    fireEvent.click(button('Build .repx'));
    expect(onBuild).toHaveBeenCalledTimes(1);
    const built = onBuild.mock.calls[0][0];
    expect(built).toMatchObject({ title: 'invoice scan', flagged: 1 });
    expect(built.repxContent).toMatch(/Name="invoicescan"/);
    expect(built.repxContent).toMatch(/Name="lowConfidenceLabel\d+" Text="Smudge"/);
    expect(built.repxContent).toMatch(/ControlType="XRTable"/);
    expect(built.layout.sections).toHaveLength(1);
    expect(built.markdown).toMatch(/Smudge \| 30/);

    fireEvent.click(screen.getByLabelText('Leave low-confidence text out of the report'));
    fireEvent.click(button('Build .repx'));
    const dropped = onBuild.mock.calls[1][0];
    expect(dropped.flagged).toBe(0);
    expect(dropped.repxContent).not.toMatch(/Smudge/);
  });

  it('reads a rendered PDF page at the resolution its page size gives it', async () => {
    recognizePage.mockResolvedValue({ ...scan, width: 1530, height: 1980 });
    const { onBuild } = draw([page(1)]);
    await ready();
    fireEvent.click(button('Build .repx'));
    // 1530 pixels across 612 points is 180 dpi, so Letter: 850 by 1100.
    expect(onBuild.mock.calls[0][0].repxContent).toMatch(/PageWidth="850" PageHeight="1100"/);
  });

  it('leaves out a page it could not read, says so, and builds from the rest', async () => {
    recognizePage.mockResolvedValueOnce(scan).mockRejectedValueOnce(new Error('out of memory'));
    const { container } = draw([page(1), page(2)]);
    await ready();
    expect(container.querySelector('.wb-ocr-runs li.is-failed')?.textContent).toMatch(/Could not be read/);
    expect(screen.getByRole('alert').textContent).toMatch(/1 of 2 pages could not be read/);
  });

  it('stops the run when asked, through the signal the engine listens to', async () => {
    let signal: AbortSignal | undefined;
    recognizePage.mockImplementation((...args: unknown[]) => {
      signal = (args[2] as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise(() => undefined);
    });
    draw();
    await waitFor(() => expect(signal).toBeDefined());
    fireEvent.click(button('Stop'));
    expect(signal?.aborted).toBe(true);
    // And the dialog is not left waiting (2026-11-06): it says it stopped and offers the read again.
    expect(screen.getByRole('alert').textContent).toMatch(/^Stopped: 1 of 1 page was not read/);
    expect(button('Try again')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('the review the chat box opens', () => {
  it('shows pages already read without reading them again, and leaves the text to the message', async () => {
    const onBuild = vi.fn();
    render(<OcrDialog pages={[page()]} preread={[scan]} unit="HundredthsOfAnInch" pageSize="Letter" onBuild={onBuild} onClose={vi.fn()} />);
    await ready();
    expect(recognizePage).not.toHaveBeenCalled();
    expect(screen.queryByText('Use for generation')).toBeNull();
    expect(screen.getByText('Close')).toBeTruthy();
    fireEvent.click(button('Build .repx'));
    expect(onBuild).toHaveBeenCalledTimes(1);
  });
});
