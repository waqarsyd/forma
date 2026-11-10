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

  /*
   * The empty state has promised something the control cannot do twice now:
   * first "Drop a folder" on a panel with no onDrop handler, then "Choose a
   * folder" on an input that has `multiple` and not `webkitdirectory`. Both
   * read fine and neither throws. This pins the copy to the input's actual
   * capability, so the next person to write "folder" here has to add the
   * attribute in the same commit.
   */
  it('does not offer a folder the picker cannot select', () => {
    render(<BatchPanel ready runOne={vi.fn()} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    const inputs = [...document.querySelectorAll('input[type=file]')] as HTMLInputElement[];
    const claimsFolders = /folder/i.test(document.body.textContent ?? '');
    // `webkitdirectory` is the only thing that makes a folder selectable.
    expect(claimsFolders).toBe(inputs.some((i) => i.hasAttribute('webkitdirectory')));
    expect(inputs[0].multiple).toBe(true);
    expect(inputs[0].hasAttribute('webkitdirectory')).toBe(false);
  });

  it('queues a chosen folder by path, leaving out what it cannot take, and says so', () => {
    render(<BatchPanel ready runOne={vi.fn()} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    const folder = document.querySelectorAll('input[type=file]')[1] as HTMLInputElement;
    const inFolder = (path: string, type: string) => Object.assign(new File(['x'], path.split('/').pop()!, { type }), { webkitRelativePath: path });
    const files = [inFolder('old/b.pdf', 'application/pdf'), inFolder('old/a.png', 'image/png'), inFolder('old/notes.xlsx', 'application/vnd.ms-excel'), inFolder('old/.DS_Store', '')];
    Object.defineProperty(folder, 'files', { configurable: true, value: Object.assign(files, { item: (i: number) => files[i] }) });
    fireEvent.change(folder);
    expect([...document.querySelectorAll('.bp-name')].map((n) => n.textContent)).toEqual(['old/a.png', 'old/b.pdf']);
    expect(screen.getByText(/2 files ready \(2 other files left out\)\. Nothing is sent until you start\./)).toBeTruthy();
  });

  it('takes files dropped on the panel', async () => {
    render(<BatchPanel ready runOne={vi.fn()} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    const dropped = [file('x.png'), file('y.png')];
    const items = dropped.map((f) => ({ kind: 'file', getAsFile: () => f }));
    fireEvent.drop(document.querySelector('.bp-root')!, { dataTransfer: { items, types: ['Files'] } });
    await waitFor(() => expect(document.querySelectorAll('.bp-row')).toHaveLength(2));
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

  it('runs as many at once as chosen, never the same file twice', async () => {
    let running = 0;
    let peak = 0;
    const runOne = vi.fn(async (f: File, _signal: AbortSignal, _id: string) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return outcome(f.name);
    });
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png', 'c.png', 'd.png', 'e.png']);
    fireEvent.change(screen.getByLabelText('At a time'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Generate 5'));
    await waitFor(() => expect(screen.getByText('5/5 done')).toBeTruthy());
    expect(peak).toBe(2);
    expect(runOne).toHaveBeenCalledTimes(5);
    expect(new Set(runOne.mock.calls.map((c) => c[2])).size).toBe(5);
  });

  it('stops every worker on a quota failure, and says so once', async () => {
    const runOne = vi.fn(async (f: File) => {
      await new Promise((r) => setTimeout(r, f.name === 'a.png' ? 1 : 10));
      if (f.name === 'a.png') throw new Error('exceeded your Gemini API quota');
      return outcome(f.name);
    });
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png', 'c.png', 'd.png']);
    fireEvent.change(screen.getByLabelText('At a time'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Generate 4'));
    await waitFor(() => expect(screen.getByText(/Paused at a limit after "a.png"/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Retry 3')).toBeTruthy());
    // b was already running beside a; c and d were never started.
    expect(runOne).toHaveBeenCalledTimes(2);
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
    await waitFor(() => expect(screen.getByText(/Paused at a limit after "a.png".*Retry carries on from here/)).toBeTruthy());
    expect(runOne).toHaveBeenCalledTimes(1);
  });

  // Batch AG, item 23 (2026-11-10): the day's allowance names no quota, and the run went on file after file.
  it('pauses on the day’s allowance, said in its own words, and stops on a rejected key', async () => {
    const daily = Object.assign(new Error("This key's free daily allowance is used up. It resets at midnight Pacific time."), { cause: { status: 429 } });
    const runOne = vi.fn(async () => { throw daily; });
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png', 'c.png']);
    fireEvent.click(screen.getByText('Generate 3'));
    await waitFor(() => expect(screen.getByText(/Paused at a limit after "a.png"/)).toBeTruthy());
    expect(runOne).toHaveBeenCalledTimes(1);
    cleanup();
    const rejected = vi.fn(async () => { throw new Error('Your Gemini API key was rejected.'); });
    render(<BatchPanel ready runOne={rejected} onOpen={vi.fn()} onNeedKey={vi.fn()} />);
    choose(['a.png', 'b.png']);
    fireEvent.click(screen.getByText('Generate 2'));
    await waitFor(() => expect(screen.getByText(/Stopped after "a.png": Your Gemini API key was rejected/)).toBeTruthy());
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  // Batch AG, item 22: files a plan in the chat sent here are queued and started.
  it('queues and starts the files a plan sent here', async () => {
    const runOne = vi.fn(async (f: File) => outcome(f.name));
    render(<BatchPanel ready runOne={runOne} onOpen={vi.fn()} onNeedKey={vi.fn()} incoming={{ files: [file('a.png'), file('b.png')], id: 1 }} />);
    await waitFor(() => expect(screen.getByText('2/2 done')).toBeTruthy());
    expect(runOne).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.queryByText('2/2 done')).toBeNull();
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
