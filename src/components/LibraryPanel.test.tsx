// @vitest-environment jsdom
/**
 * The panel's job is to stop the library filling with things that should not be
 * house style, so that is what these check.
 *
 * **Canonical is off by default.** The real corpus this was measured against holds
 * five `Job_Card_Report (1)…(5)` variants and two near-empty stubs; an import path
 * that made everything canonical would show a model a draft as an example of how
 * this organisation formats reports.
 *
 * **A file that produced nothing is named.** `Sample empt report..repx` exists in
 * that corpus. Silently ignoring it leaves someone waiting for a file that is never
 * going to appear in the list.
 *
 * **The picker is cleared after a pick**, because re-choosing the same file is the
 * obvious response to a failed import and a file input will not fire `change` for
 * an unchanged value.
 *
 * **It counts reports, in plain words** (2026-11-11, the full audit's WS-24): the
 * files a person added, never fragments, embedding or an "API key".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import LibraryPanel from './LibraryPanel';
import type { ImportResult, LibrarySource } from '../services/library';

afterEach(cleanup);

/** The library's machinery, which nothing the panel says may name. */
const MACHINERY = /fragment|embed|chunk|vector|import|API key/i;

const result = (over: Partial<ImportResult> = {}): ImportResult => ({
  added: 2,
  skipped: 0,
  embedded: 2,
  pending: 0,
  empty: [],
  ...over,
});

const source = (name: string, chunks = 4, embedded = 4): LibrarySource => ({ name, chunks, embedded });

const panel = (over: Partial<React.ComponentProps<typeof LibraryPanel>> = {}) => {
  const props = {
    sources: [] as readonly LibrarySource[],
    canonical: new Set<string>(),
    onImport: vi.fn(async () => result()),
    onRemove: vi.fn(),
    onToggleCanonical: vi.fn(),
    ready: true,
    onNeedKey: vi.fn(),
    ...over,
  };
  render(<LibraryPanel {...props} />);
  return props;
};

/** Puts files into the panel's own input, as a picker would. */
const choose = (names: string[]) => {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  const files = names.map((name) => new File(['<xml/>'], name, { type: 'text/xml' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
  return input;
};

describe('an empty library', () => {
  it('says what to put in it rather than showing an empty list', () => {
    panel();
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
  });

  it('offers the import button', () => {
    panel();
    expect(screen.getByRole('button', { name: /Add \.repx files/ })).toBeTruthy();
  });
});

describe('importing', () => {
  it('only offers .repx, because nothing else has structure to read', () => {
    panel();
    expect(document.querySelector('input[type=file]')?.getAttribute('accept')).toBe('.repx');
  });

  it('hands the chosen files over and says how many reports were added', async () => {
    // Held separately from the props object: the spread in `panel` widens the
    // mock to its plain function type and `tsc` then loses `.mock`.
    const onImport = vi.fn(async (_files: File[]) => result({ added: 7, skipped: 3 }));
    panel({ onImport });
    choose(['a.repx', 'b.repx']);

    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0][0].map((f) => f.name)).toEqual(['a.repx', 'b.repx']);
    await waitFor(() => expect(screen.getByText('Added 2 reports.')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(MACHINERY);
  });

  it('says a report the library already held, by report, not by its pieces', async () => {
    panel({ sources: [source('Invoice.repx')], onImport: vi.fn(async () => result({ added: 9, skipped: 4, empty: ['Blank.repx'] })) });
    choose(['Invoice.repx', 'Orders.repx', 'Stock.repx', 'Blank.repx']);
    await waitFor(() => expect(screen.getByText('Added 2 reports. 1 report was already in the library.')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(MACHINERY);
  });

  // WS-24's review: the library keeps pieces by content, so a held name that changed is an update.
  it('says a held report whose content changed was updated, and an unchanged one was already there', async () => {
    panel({ sources: [source('Invoice.repx')], onImport: vi.fn(async () => result({ added: 3, skipped: 1 })) });
    choose(['Invoice.repx']);
    await waitFor(() => expect(screen.getByText('Updated 1 report.')).toBeTruthy());
    cleanup();
    panel({ sources: [source('Invoice.repx')], onImport: vi.fn(async () => result({ added: 0, skipped: 4 })) });
    choose(['Invoice.repx']);
    await waitFor(() => expect(screen.getByText('1 report was already in the library.')).toBeTruthy());
  });

  it('names a file that produced no report content', async () => {
    panel({ onImport: vi.fn(async () => result({ empty: ['Sample empt report..repx'] })) });
    choose(['Sample empt report..repx']);
    await waitFor(() => expect(screen.getByText('Nothing in Sample empt report..repx could be read as a report.')).toBeTruthy());
  });

  it('shows the failure instead of pretending the import worked', async () => {
    panel({ onImport: vi.fn(async () => { throw new Error('the key was rejected'); }) });
    choose(['a.repx']);
    await waitFor(() => expect(screen.getByText('the key was rejected')).toBeTruthy());
  });

  it('clears the picker so the same file can be chosen again after a failure', async () => {
    panel({ onImport: vi.fn(async () => { throw new Error('nope'); }) });
    const input = choose(['a.repx']);
    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy());
    expect(input.value).toBe('');
  });

  it('does nothing at all when the picker was cancelled', async () => {
    const props = panel();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    fireEvent.change(input);
    expect(props.onImport).not.toHaveBeenCalled();
  });

  it('asks for a key instead of opening a picker that cannot finish', () => {
    const props = panel({ ready: false });
    fireEvent.click(screen.getByRole('button', { name: /Add \.repx files/ }));
    expect(props.onNeedKey).toHaveBeenCalled();
    expect(props.onImport).not.toHaveBeenCalled();
    expect(screen.getByText('Adding reports needs your Gemini key.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(MACHINERY);
  });
});

describe('a stocked library', () => {
  const stocked = [source('Invoice.repx'), source('Job_Card_Report.repx', 11, 8)];

  it('lists each file once, and counts reports', () => {
    panel({ sources: stocked });
    expect(screen.getByText('Invoice.repx')).toBeTruthy();
    expect(screen.getByText('Job_Card_Report.repx')).toBeTruthy();
    expect(document.querySelector('.lp-summary')?.textContent).toBe('2 reports');
  });

  it('says which reports are still being read, rather than implying all are usable', () => {
    panel({ sources: [...stocked, source('Stock.repx', 3, 0)] });
    expect(screen.getByText('2 reports are still being read; they are used once ready.')).toBeTruthy();
    expect([...document.querySelectorAll('.lp-count')].map((e) => e.textContent)).toEqual(['', 'Being read', 'Being read']);
    expect(document.body.textContent).not.toMatch(MACHINERY);
  });

  it('says nothing is being read once every report is ready', () => {
    panel({ sources: [source('Invoice.repx')] });
    expect(screen.queryByText(/still being read/)).toBeNull();
  });

  it('leaves every file un-canonical until someone says otherwise', () => {
    panel({ sources: stocked });
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.every((box) => !box.checked)).toBe(true);
    expect(screen.getByText(/Nothing is used until you do/)).toBeTruthy();
  });

  it('reports a file being made canonical', () => {
    const props = panel({ sources: stocked });
    fireEvent.click(screen.getByLabelText('Use Invoice.repx as house style'));
    expect(props.onToggleCanonical).toHaveBeenCalledWith('Invoice.repx', true);
  });

  it('reports a file being taken back out of the canonical set', () => {
    const props = panel({ sources: stocked, canonical: new Set(['Invoice.repx']) });
    fireEvent.click(screen.getByLabelText('Use Invoice.repx as house style'));
    expect(props.onToggleCanonical).toHaveBeenCalledWith('Invoice.repx', false);
  });

  it('stops nagging once something is canonical', () => {
    panel({ sources: stocked, canonical: new Set(['Invoice.repx']) });
    expect(screen.queryByText(/Nothing is used until you do/)).toBeNull();
  });

  it('removes a file by name', () => {
    const props = panel({ sources: stocked });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(props.onRemove).toHaveBeenCalledWith('Invoice.repx');
  });
});

/* A drop on the panel (2026-11-11, the full audit's WS-13): into the library, never past it to the box behind. */
describe('dropping files on the panel', () => {
  const drop = (names: string[]) => {
    const files = names.map((name) => new File(['<xml/>'], name, { type: 'text/xml' }));
    const outside = vi.fn();
    document.body.addEventListener('drop', outside);
    fireEvent.drop(document.querySelector('.lp-panel')!, { dataTransfer: { files, types: ['Files'] } });
    document.body.removeEventListener('drop', outside);
    return outside;
  };

  it('adds the .repx files dropped, and the drop goes no further', async () => {
    const onImport = vi.fn(async (_files: File[]) => result());
    panel({ onImport });
    const outside = drop(['a.repx', 'photo.png', 'b.REPX']);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0].map((f) => f.name)).toEqual(['a.repx', 'b.REPX']);
    expect(outside).not.toHaveBeenCalled();
    // The file that is not a report is named, not dropped without a word.
    await waitFor(() => expect(screen.getByText(/so photo\.png was left out\./)).toBeTruthy());
  });

  it('says so when a drop comes while reports are still going in', async () => {
    let finish: (value: ImportResult) => void = () => undefined;
    const onImport = vi.fn((_files: File[]) => new Promise<ImportResult>((resolve) => { finish = resolve; }));
    panel({ onImport });
    drop(['a.repx']);
    await waitFor(() => expect(screen.getByText('Adding…')).toBeTruthy());
    drop(['b.repx']);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Still adding the last reports/)).toBeTruthy();
    finish(result());
    await waitFor(() => expect(screen.queryByText('Adding…')).toBeNull());
  });

  it('says so when nothing dropped is a report', () => {
    const onImport = vi.fn(async (_files: File[]) => result());
    panel({ onImport });
    drop(['photo.png']);
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByText('Only .repx files go into the library.')).toBeTruthy();
  });

  it('asks for the key first, as the button does', () => {
    const props = panel({ ready: false });
    drop(['a.repx']);
    expect(props.onNeedKey).toHaveBeenCalledTimes(1);
    expect(props.onImport).not.toHaveBeenCalled();
  });
});
