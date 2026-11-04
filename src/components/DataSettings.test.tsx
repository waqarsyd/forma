// @vitest-environment jsdom
/**
 * Right to left and the stored procedure in Settings (2026-11-04). The engine
 * honoured both before anything set them; this proves the controls set the
 * fields the prompt and `repxRtl.ts` read, and that the data schema, which
 * belongs to the Data tab, is not offered here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DataSettings from './DataSettings';
import type { ReportConfig } from '../services/geminiService';

afterEach(cleanup);

const config = (over: Partial<ReportConfig> = {}): ReportConfig => ({ version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter', ...over }) as ReportConfig;

describe('DataSettings', () => {
  it('sets right to left and the stored procedure', () => {
    const onChange = vi.fn();
    render(<DataSettings config={config()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Right to left/));
    expect(onChange).toHaveBeenLastCalledWith({ rtl: true });
    fireEvent.change(screen.getByLabelText('Stored procedure'), { target: { value: 'dbo.GetSales' } });
    expect(onChange).toHaveBeenLastCalledWith({ spName: 'dbo.GetSales' });
  });

  it('shows what is set', () => {
    render(<DataSettings config={config({ rtl: true, spName: 'dbo.X' })} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/Right to left/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Stored procedure') as HTMLInputElement).value).toBe('dbo.X');
  });

  it('sends a data schema to the Data tab rather than taking one', () => {
    render(<DataSettings config={config()} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/schema/i)).toBeNull();
    expect(document.body.textContent).toMatch(/Data tab/);
  });
});
