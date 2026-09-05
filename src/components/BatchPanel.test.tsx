// @vitest-environment jsdom
/**
 * The batch run loop.
 *
 * `batchQueue.ts` proves the transitions; this proves the LOOP that drives
 * them, which is where the interesting mistake lives. The loop runs across many
 * awaits, and a closure over the `queue` state variable would see the array as
 * it was when the run started — so every result but the last would be
 * overwritten and the panel would finish showing one done file out of three.
 * That is invisible to a state-machine test and to a screenshot of a
 * single-file run.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import BatchPanel from './BatchPanel';

afterEach(cleanup);

const file = (name: string) => new File(['x'], name, { type: 'image/png' });

/** Puts files into the panel's own input, as a picker would. */
const choose = (names: string[]) => {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: Object.assign(names.map(file), { item: (i: number) => names.map(file)[i], length: names.length }),
  });
  fireEvent.change(input);
};

const outcome = (title: string) => ({
  title, repxContent: `<x>${title}</x>`, bands: 3, errors: 0, warnings: 0,
});

describe('queueing', () => {
  it('says nothing is sent until the user starts', () => {
    render(<BatchPanel ready runOne={vi.fn()} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png']);
    expect(screen.getByText(/2 files ready\. Nothing is sent until you start\./)).toBeTruthy();
  });

  it('explains that this is not the composer with more files', () => {
    render(<BatchPanel ready runOne={vi.fn()} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    expect(document.body.textContent).toMatch(/different from attaching several files to the composer/i);
  });

  it('makes one row per file', () => {
    render(<BatchPanel ready runOne={vi.fn()} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png', 'c.png']);
    expect(document.querySelectorAll('.bp-row')).toHaveLength(3);
  });
});

describe('running the queue', () => {
  it('records EVERY file\'s result, not only the last', async () => {
    // The trap this file exists for. With the loop closed over React state
    // instead of a ref, files 1 and 2 finish and are then overwritten by the
    // stale array file 3 was recorded against.
    const runOne = vi.fn(async (f: File) => outcome(f.name.replace('.png', '')));
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png', 'c.png']);
    fireEvent.click(screen.getByText('Generate 3'));

    await waitFor(() => expect(screen.getByText('3/3 done')).toBeTruthy());
    expect(runOne).toHaveBeenCalledTimes(3);
    for (const name of ['a', 'b', 'c']) expect(screen.getByText(name)).toBeTruthy();
    expect(document.querySelectorAll('.bp-verdict')).toHaveLength(3);
  });

  it('runs them one at a time', async () => {
    let running = 0;
    let peak = 0;
    const runOne = vi.fn(async (f: File) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return outcome(f.name);
    });
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png', 'c.png']);
    fireEvent.click(screen.getByText('Generate 3'));
    await waitFor(() => expect(screen.getByText('3/3 done')).toBeTruthy());
    // Forty parallel requests turn a slow success into a fast 429.
    expect(peak).toBe(1);
  });

  it('shows the audit verdict rather than only that it finished', async () => {
    const runOne = vi.fn(async () => ({ ...outcome('R'), errors: 2, warnings: 1 }));
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png']);
    fireEvent.click(screen.getByText('Generate 1'));
    await waitFor(() => expect(screen.getByText(/2 errors — content will be lost/)).toBeTruthy());
  });

  it('keeps going after one file fails', async () => {
    const runOne = vi.fn(async (f: File) => {
      if (f.name === 'b.png') throw new Error('unreadable PDF');
      return outcome(f.name);
    });
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png', 'c.png']);
    fireEvent.click(screen.getByText('Generate 3'));
    await waitFor(() => expect(screen.getByText('2/3 done')).toBeTruthy());
    expect(screen.getByText('unreadable PDF')).toBeTruthy();
    expect(runOne).toHaveBeenCalledTimes(3);
  });

  it('stops the whole run on a quota failure instead of repeating it forty times', async () => {
    const runOne = vi.fn(async () => { throw new Error('exceeded your Gemini API quota'); });
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png', 'c.png']);
    fireEvent.click(screen.getByText('Generate 3'));
    await waitFor(() => expect(screen.getByText(/Stopped after "a.png"/)).toBeTruthy());
    expect(runOne).toHaveBeenCalledTimes(1);
  });

  it('offers to retry what did not finish', async () => {
    const runOne = vi.fn(async (f: File) => {
      if (f.name === 'b.png') throw new Error('network');
      return outcome(f.name);
    });
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png']);
    fireEvent.click(screen.getByText('Generate 2'));
    await waitFor(() => expect(screen.getByText('Retry 1')).toBeTruthy());
  });
});

describe('the key gate', () => {
  it('asks for a key instead of failing every file', () => {
    const onNeedKey = vi.fn();
    const runOne = vi.fn();
    render(<BatchPanel ready={false} runOne={runOne} onOpen={vi.fn()} onNeedKey={onNeedKey} />);
    choose(['a.png']);
    fireEvent.click(screen.getByText('Generate 1'));
    expect(onNeedKey).toHaveBeenCalled();
    expect(runOne).not.toHaveBeenCalled();
  });
});
