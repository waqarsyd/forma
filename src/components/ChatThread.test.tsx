// @vitest-environment jsdom
/**
 * The review column's transcript.
 *
 * Written *before* `App.tsx` was switched over to this component, which is the
 * whole reason it exists. The transcript had no coverage of any kind, so an
 * extract-then-check would have been unverified by construction — the same
 * order that produced the state bug `DataBinding.test.tsx` was added after.
 *
 * `chatSession.test.ts` proves the rules that rewrite the transcript. This
 * proves what those rules look like on screen: the two role treatments, the
 * grouping that turns eight PDF pages back into one thumbnail, the failure that
 * has to appear beside the turn that failed, and the placeholder that must not
 * appear during a generation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ChatThread from './ChatThread';
import type { PreviewMeta } from '../lib/attachments';
import type { ChatMessage } from '../lib/chatSession';

afterEach(cleanup);

type Msg = ChatMessage<unknown, PreviewMeta>;

const msg = (over: Partial<Msg> & { id: string }): Msg => ({
  role: 'user',
  text: '',
  ...over,
});

/** One page of an upload. Consecutive entries sharing an id are one file. */
const page = (uploadId: string, file: string, p?: number): PreviewMeta => ({
  uploadId,
  file,
  ...(p === undefined ? {} : { page: p }),
});

const draw = (props: Partial<React.ComponentProps<typeof ChatThread<unknown>>> = {}) =>
  render(
    <ChatThread
      messages={[]}
      isChatting={false}
      isAnalyzing={false}
      streamingReply=""
      onRetry={vi.fn()}
      onOpenAttachment={vi.fn()}
      {...props}
    />
  );

describe('who said it', () => {
  it('labels the two roles and marks only the user note', () => {
    draw({
      messages: [
        msg({ id: '1', role: 'user', text: 'build me a report' }),
        msg({ id: '2', role: 'assistant', text: 'done' }),
      ],
    });

    const notes = document.querySelectorAll('.wb-note');
    expect(notes).toHaveLength(2);
    expect(notes[0].className).toContain('wb-note--me');
    expect(notes[1].className).not.toContain('wb-note--me');
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Forma')).toBeTruthy();
  });

  // A generation pushes an assistant message whose text is empty when the model
  // returned only a result. An empty <p> there is a visible gap in the column.
  it('renders no paragraph for a message with no text', () => {
    draw({ messages: [msg({ id: '1', text: '' })] });
    expect(document.querySelector('.wb-note p')).toBeNull();
  });
});

describe('attachments', () => {
  // The behaviour the whole PreviewMeta type parameter exists to protect:
  // grouping is by uploadId, so three pages of one PDF are one thumbnail
  // carrying a page count, not three thumbnails.
  it('collapses the pages of one upload into a single thumbnail', () => {
    draw({
      messages: [
        msg({
          id: '1',
          images: ['data:image/png;base64,A', 'data:image/png;base64,B', 'data:image/png;base64,C'],
          imageMeta: [page('u1', 'invoice.pdf', 1), page('u1', 'invoice.pdf', 2), page('u1', 'invoice.pdf', 3)],
        }),
      ],
    });

    const shots = document.querySelectorAll('.wb-attach-shot');
    expect(shots).toHaveLength(1);
    expect(shots[0].getAttribute('aria-label')).toBe('View invoice.pdf · 3 pages');
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('keeps two separate uploads apart even when they share a filename', () => {
    draw({
      messages: [
        msg({
          id: '1',
          images: ['data:image/png;base64,A', 'data:image/png;base64,B'],
          imageMeta: [page('u1', 'scan.pdf'), page('u2', 'scan.pdf')],
        }),
      ],
    });
    expect(document.querySelectorAll('.wb-attach-shot')).toHaveLength(2);
  });

  // Reports saved before imageMeta existed reload with images and no meta.
  // Dropping them would silently empty the strip on every old saved project.
  it('still draws one thumbnail per image when the metadata is missing', () => {
    draw({
      messages: [msg({ id: '1', images: ['data:image/png;base64,A', 'data:image/png;base64,B'] })],
    });
    expect(document.querySelectorAll('.wb-attach-shot')).toHaveLength(2);
  });

  it('hands the whole group to the viewer, not just the page clicked', () => {
    const onOpenAttachment = vi.fn();
    draw({
      onOpenAttachment,
      messages: [
        msg({
          id: '1',
          images: ['data:image/png;base64,A', 'data:image/png;base64,B'],
          imageMeta: [page('u1', 'invoice.pdf', 1), page('u1', 'invoice.pdf', 2)],
        }),
      ],
    });

    fireEvent.click(document.querySelector('.wb-attach-shot')!);
    expect(onOpenAttachment).toHaveBeenCalledWith({
      srcs: ['data:image/png;base64,A', 'data:image/png;base64,B'],
      index: 0,
      file: 'invoice.pdf',
    });
  });

  it('draws no strip at all for a message with no images', () => {
    draw({ messages: [msg({ id: '1', text: 'just words' })] });
    expect(document.querySelector('.wb-attach-strip')).toBeNull();
  });
});

describe('a turn that failed', () => {
  it('shows the failure beside the message, as an alert', () => {
    draw({ messages: [msg({ id: '1', text: 'do it', error: 'The model is overloaded.' })] });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The model is overloaded.');
  });

  it('retries the message it belongs to', () => {
    const onRetry = vi.fn();
    draw({
      onRetry,
      messages: [
        msg({ id: 'first', text: 'one' }),
        msg({ id: 'second', text: 'two', error: 'failed' }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledWith('second');
  });

  // Retrying mid-flight would stack a second request on top of the running one.
  it('refuses a retry while a chat turn is in flight', () => {
    draw({
      isChatting: true,
      messages: [msg({ id: '1', error: 'failed' })],
    });
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses a retry while a generation is in flight', () => {
    draw({
      isAnalyzing: true,
      messages: [msg({ id: '1', error: 'failed' })],
    });
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('leaves a healthy message with no alert and no retry', () => {
    draw({ messages: [msg({ id: '1', text: 'fine' })] });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

/*
 * The note rows are memoised, because typing in the composer re-rendered every
 * one of them on every keystroke — measured at 264 note renders for a 22
 * character sentence with six notes on screen. Memoising introduces exactly one
 * hazard, and this is it: a row that skips re-rendering must not also freeze the
 * callback it was first handed, or a retry acts on the transcript as it was
 * when that row was created. The component reads its callbacks through a ref to
 * avoid that; this proves the ref works rather than trusting it.
 */
describe('memoised rows still call the current callbacks', () => {
  it('retries through the newest handler, not the one it first received', () => {
    const first = vi.fn();
    const second = vi.fn();
    const messages = [msg({ id: '1', text: 'do it', error: 'failed' })];

    const { rerender } = render(
      <ChatThread
        messages={messages}
        isChatting={false}
        isAnalyzing={false}
        streamingReply=""
        onRetry={first}
        onOpenAttachment={vi.fn()}
      />
    );

    // Same message objects, new callback — exactly what a re-render of App.tsx
    // produces when only the composer's prompt changed.
    rerender(
      <ChatThread
        messages={messages}
        isChatting={false}
        isAnalyzing={false}
        streamingReply=""
        onRetry={second}
        onOpenAttachment={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('1');
  });

  it('opens an attachment through the newest handler too', () => {
    const first = vi.fn();
    const second = vi.fn();
    const messages = [msg({ id: '1', images: ['data:image/png;base64,A'] })];
    const props = { messages, isChatting: false, isAnalyzing: false, streamingReply: '', onRetry: vi.fn() };

    const { rerender } = render(<ChatThread {...props} onOpenAttachment={first} />);
    rerender(<ChatThread {...props} onOpenAttachment={second} />);

    fireEvent.click(document.querySelector('.wb-attach-shot')!);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('redraws a row when its own message changes', () => {
    const props = { isChatting: false, isAnalyzing: false, streamingReply: '', onRetry: vi.fn(), onOpenAttachment: vi.fn() };
    const { rerender } = render(<ChatThread {...props} messages={[msg({ id: '1', text: 'before' })]} />);
    expect(screen.getByText('before')).toBeTruthy();

    rerender(<ChatThread {...props} messages={[msg({ id: '1', text: 'after' })]} />);
    expect(screen.getByText('after')).toBeTruthy();
    expect(screen.queryByText('before')).toBeNull();
  });
});

describe('the reply being written', () => {
  it('says it is thinking before the first token arrives', () => {
    draw({ isChatting: true });
    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  it('shows the text streamed so far once there is some', () => {
    draw({ isChatting: true, streamingReply: 'Forma supports PNG, JPG' });
    expect(screen.getByText('Forma supports PNG, JPG')).toBeTruthy();
    expect(screen.queryByText('Thinking…')).toBeNull();
  });

  it('announces itself politely', () => {
    draw({ isChatting: true });
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  /*
   * The one that would ship broken. A message the assistant judges to be a real
   * build request runs the chat turn and then falls through to generation, so
   * both flags are true together for a moment. Without the `!isAnalyzing` guard
   * the thinking placeholder sits above the progress card, claiming a second job
   * that is not running.
   */
  it('gets out of the way once generation starts', () => {
    draw({ isChatting: true, isAnalyzing: true, streamingReply: 'building' });
    expect(screen.queryByText('building')).toBeNull();
    expect(screen.queryByText('Thinking…')).toBeNull();
  });

  it('shows nothing when idle', () => {
    draw({ messages: [msg({ id: '1', text: 'hello' })] });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(1);
  });
});

describe('the progress card passed through', () => {
  it('renders children last, inside the thread', () => {
    draw({
      messages: [msg({ id: '1', text: 'hello' })],
      children: <div data-testid="progress">generating</div>,
    });

    const thread = document.querySelector('.wb-thread')!;
    expect(thread.lastElementChild?.getAttribute('data-testid')).toBe('progress');
  });

  it('renders the transcript alone when there are no children', () => {
    draw({ messages: [msg({ id: '1', text: 'hello' })] });
    expect(document.querySelector('.wb-thread')!.children).toHaveLength(1);
  });
});
