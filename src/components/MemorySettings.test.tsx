// @vitest-environment jsdom
/**
 * Settings > Memory (MemorySettings.tsx): since 2026-11-11 (the full audit's
 * D4) what the person's changes taught is listed apart from what they said,
 * under "Learned from your changes", each with a switch and a Forget that
 * takes what it was counted from with it. jsdom; this must stay line 1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MemorySettings from './MemorySettings';
import { keptStyleOf, memoryFrom, readMemory, setMemoryAccount, writeMemory, type Memory } from '../lib/memory';
import type { Correction } from '../lib/corrections';

// The library's kept store, which the two Forget buttons clear too (the LRN2 review, 2026-11-11).
const library = vi.hoisted(() => ({ forgetKept: vi.fn(async () => undefined), defaultDeps: vi.fn(() => ({ kept: 'the store' })) }));
vi.mock('../services/library', () => library);

afterEach(() => {
  cleanup();
  setMemoryAccount(null);
});
beforeEach(() => {
  localStorage.clear();
  library.forgetKept.mockClear();
});

const learned: Memory = { id: 'learned-size-title', text: 'Titles at 18pt', source: 'learned', created: '2026-11-11T00:00:00Z', enabled: true, hints: { sizes: { title: 18 } } };
const entry = (ref: string): Correction => ({ kind: 'size', part: 'title', value: '18', weight: 1, ref, at: '2026-11-11T00:00:00Z' });
const other: Correction = { kind: 'margin', part: 'left', value: '1', weight: 1, ref: 'm9', at: '2026-11-11T00:00:00Z' };

describe('what was learned from the changes', () => {
  it('is listed apart from what the person said, in plain words', () => {
    writeMemory({ memories: [memoryFrom('Always use A4', 'settings'), learned], kept: [], learnFromKept: true, ledger: [entry('m1'), entry('m2')] });
    render(<MemorySettings />);
    const list = screen.getByRole('list', { name: 'Learned from your changes' });
    expect(within(list).getByText('Titles at 18pt')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Memories' })).queryByDisplayValue('Titles at 18pt')).toBeNull();
    expect(document.body.textContent).not.toMatch(/ledger|correction|model|token/i);
  });

  it('can be switched off, and stays a memory', () => {
    writeMemory({ memories: [learned], kept: [], learnFromKept: true, ledger: [entry('m1'), entry('m2')] });
    render(<MemorySettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Use: Titles at 18pt' }));
    expect(readMemory().memories).toEqual([{ ...learned, enabled: false }]);
    expect(screen.getByRole('switch', { name: 'Off: Titles at 18pt' })).toBeTruthy();
  });

  it('is forgotten with what it was counted from, and nothing else', () => {
    writeMemory({ memories: [learned], kept: [], learnFromKept: true, ledger: [entry('m1'), entry('m2'), other] });
    render(<MemorySettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget: Titles at 18pt' }));
    expect(readMemory().memories).toEqual([]);
    expect(readMemory().ledger).toEqual([other]);
    expect(screen.queryByRole('list', { name: 'Learned from your changes' })).toBeNull();
  });

  it('is not shown when nothing has been learned', () => {
    writeMemory({ memories: [memoryFrom('Always use A4', 'settings')], kept: [], learnFromKept: true });
    render(<MemorySettings />);
    expect(screen.queryByText('Learned from your changes')).toBeNull();
  });
});

describe('forgetting the kept reports', () => {
  const REPORT =
    '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Name="R" Margins="40, 40, 50, 50" PageWidth="827" PageHeight="1169" PaperKind="A4"><Bands>' +
    '<Item1 Ref="1" ControlType="DetailBand" HeightF="20"><Controls><Item1 Ref="2" ControlType="XRLabel" Text="x" Font="Tahoma, 8pt" SizeF="100,20" LocationFloat="0,0" /></Controls></Item1></Bands></XtraReportsLayoutSerializer>';

  for (const [button, confirm] of [['Forget kept reports', 'Forget kept reports'], ['Forget everything', 'Forget everything']] as const) {
    it(`takes them out of the library as well as the memory: ${button}`, async () => {
      setMemoryAccount('alice');
      writeMemory({ memories: [], kept: [keptStyleOf(REPORT, new Date(), 'p1')!], learnFromKept: true });
      render(<MemorySettings />);
      fireEvent.click(screen.getByRole('button', { name: button }));
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: confirm }));
      expect(readMemory().kept).toEqual([]);
      // This account's, in the store the Library panel lists and a first report is shown from.
      await waitFor(() => expect(library.forgetKept).toHaveBeenCalledWith('alice', { kept: 'the store' }));
    });
  }

  it('leaves the library alone on Cancel', () => {
    writeMemory({ memories: [], kept: [keptStyleOf(REPORT, new Date(), 'p1')!], learnFromKept: true });
    render(<MemorySettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(library.forgetKept).not.toHaveBeenCalled();
    expect(readMemory().kept).toHaveLength(1);
  });
});
