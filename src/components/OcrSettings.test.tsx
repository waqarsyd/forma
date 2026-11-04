// @vitest-environment jsdom
/**
 * The OCR languages in Settings (2026-11-04): the boxes set the field
 * `ocrLanguages` holds, English is never offered because it is always read,
 * and the cost of a choice is said before anything is downloaded.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import OcrSettings from './OcrSettings';
import type { ReportConfig } from '../services/geminiService';

afterEach(cleanup);

const config = (over: Partial<ReportConfig> = {}): ReportConfig => ({ version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter', ...over }) as ReportConfig;

describe('OcrSettings', () => {
  it('adds and takes away a language, keeping the list order', () => {
    const onChange = vi.fn();
    render(<OcrSettings config={config({ ocrLanguages: ['spa'] })} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Arabic'));
    expect(onChange).toHaveBeenLastCalledWith({ ocrLanguages: ['ara', 'spa'] });
    fireEvent.click(screen.getByLabelText('Spanish'));
    expect(onChange).toHaveBeenLastCalledWith({ ocrLanguages: [] });
  });

  it('does not offer English, which is always read', () => {
    render(<OcrSettings config={config()} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('English')).toBeNull();
    expect(document.body.textContent).toContain('OCR always reads English');
  });

  it('turns handwriting on, and says when this site does not serve its model', async () => {
    const onChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    render(<OcrSettings config={config()} onChange={onChange} />);
    const box = screen.getByLabelText('Read handwriting (English)') as HTMLInputElement;
    expect(await screen.findByText('This site does not serve the handwriting model.')).toBeTruthy();
    expect(box.disabled).toBe(true);
    vi.unstubAllGlobals();
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    render(<OcrSettings config={config()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Read handwriting (English)'));
    expect(onChange).toHaveBeenLastCalledWith({ ocrHandwriting: true });
    vi.unstubAllGlobals();
  });

  it('says what the chosen languages cost, and nothing when none is chosen', () => {
    const { rerender } = render(<OcrSettings config={config()} onChange={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<OcrSettings config={config({ ocrLanguages: ['ara', 'fra'] })} onChange={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toMatch(/^2\.4 MB more the first time OCR runs/);
  });
});
