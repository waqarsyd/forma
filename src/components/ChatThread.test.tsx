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
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
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
  // Three dots and no words before the first token (2026-11-04): the chat shows
  // that Forma is working, not what it is doing behind the scenes.
  it('shows working dots before the first token arrives, named for a screen reader', () => {
    draw({ isChatting: true });
    expect(screen.getByRole('status', { name: 'Forma is working' }).querySelectorAll('.wb-dots i')).toHaveLength(3);
  });

  it('shows the text streamed so far once there is some', () => {
    draw({ isChatting: true, streamingReply: 'Forma supports PNG, JPG' });
    expect(screen.getByText('Forma supports PNG, JPG')).toBeTruthy();
    expect(document.querySelector('.wb-dots')).toBeNull();
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
    expect(document.querySelector('.wb-dots')).toBeNull();
  });

  it('shows nothing when idle', () => {
    draw({ messages: [msg({ id: '1', text: 'hello' })] });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(1);
  });
});

/*
 * Following the conversation.
 *
 * `.wb-thread` is the scrolling element (`flex: 1; overflow-y: auto`), so once a
 * transcript is taller than the column the newest note is below the fold and the
 * reader has to scroll down to every reply. `App.tsx` has carried a
 * `messagesEndRef` and a `scrollIntoView` effect since before the 2026-08-12
 * port, but the port replaced the markup with the artifact's, which has no
 * sentinel div — so the ref attached to nothing and the effect has been a no-op
 * ever since. Reported from real use, not found by a test.
 *
 * jsdom does no layout, so `scrollHeight` and `clientHeight` are 0 and have to
 * be defined per test. That is the price of testing scroll behaviour here, and
 * it is worth paying: the interesting half of this feature is when it must
 * *not* fire.
 */
describe('following the newest note', () => {
  const thread = () => document.querySelector('.wb-thread') as HTMLDivElement;

  /** Give the element the geometry jsdom will not compute. */
  const layout = (el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop: number) => {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
    el.scrollTop = scrollTop;
  };

  const base = { isChatting: false, isAnalyzing: false, streamingReply: '', onRetry: vi.fn(), onOpenAttachment: vi.fn() };

  it('scrolls to the bottom when a note arrives and the reader is already there', () => {
    const { rerender } = render(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' })]} />);
    layout(thread(), 1000, 300, 700); // 700 + 300 === 1000, exactly at the bottom
    fireEvent.scroll(thread());

    layout(thread(), 1400, 300, 700); // a note was added; the content grew
    rerender(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' }), msg({ id: '2', text: 'two' })]} />);

    expect(thread().scrollTop).toBe(1400);
  });

  // The half that matters. Someone reading back through the conversation must
  // not be yanked to the bottom every time a reply lands.
  it('leaves a reader who has scrolled up where they are', () => {
    const { rerender } = render(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' })]} />);
    layout(thread(), 1000, 300, 120); // far from the bottom
    fireEvent.scroll(thread());

    layout(thread(), 1400, 300, 120);
    rerender(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' }), msg({ id: '2', text: 'two' })]} />);

    expect(thread().scrollTop).toBe(120);
  });

  it('starts following again once the reader returns to the bottom', () => {
    const { rerender } = render(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' })]} />);
    layout(thread(), 1000, 300, 120);
    fireEvent.scroll(thread());

    layout(thread(), 1000, 300, 700); // scrolled back down
    fireEvent.scroll(thread());

    layout(thread(), 1400, 300, 700);
    rerender(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' }), msg({ id: '2', text: 'two' })]} />);

    expect(thread().scrollTop).toBe(1400);
  });

  // The reply arrives a token at a time, so following it is what keeps the text
  // being written visible rather than just its first line.
  it('follows the streaming reply as it grows', () => {
    const { rerender } = render(<ChatThread {...base} isChatting messages={[]} streamingReply="Forma" />);
    layout(thread(), 800, 300, 500);
    fireEvent.scroll(thread());

    layout(thread(), 900, 300, 500);
    rerender(<ChatThread {...base} isChatting messages={[]} streamingReply="Forma supports PNG, JPG" />);

    expect(thread().scrollTop).toBe(900);
  });

  it('is tolerant of being a few pixels off the bottom', () => {
    const { rerender } = render(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' })]} />);
    layout(thread(), 1000, 300, 680); // 20px short, still "at the bottom"
    fireEvent.scroll(thread());

    layout(thread(), 1400, 300, 680);
    rerender(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' }), msg({ id: '2', text: 'two' })]} />);

    expect(thread().scrollTop).toBe(1400);
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

/*
 * The chat box took over the Describe dialog (2026-11-01): its follow-up
 * questions are a form in the thread, each field holding its suggestion.
 * Since 2026-11-05 an empty conversation shows nothing: no opening note and
 * no predefined descriptions, at the owner's request.
 */
describe('a report described in the chat', () => {
  it('shows nothing in an empty conversation', () => {
    draw({});
    expect(document.querySelector('.wb-thread')!.textContent).toBe('');
    expect(document.querySelector('.wb-note')).toBeNull();
  });

  it('asks its questions as a form holding the suggestions, and hands up the answers', () => {
    const onAnswer = vi.fn();
    const asking = msg({
      id: 'q',
      role: 'assistant',
      text: 'Before I design it, 2 questions.',
      clarify: { answered: false, questions: [
        { id: 'group', question: 'Group by what?', suggestion: 'Region' },
        { id: 'total', question: 'Total of what?' },
      ] },
    });
    draw({ messages: [asking], onAnswer });
    const group = screen.getByLabelText('Group by what?') as HTMLInputElement;
    expect(group.value).toBe('Region');
    fireEvent.change(screen.getByLabelText('Total of what?'), { target: { value: 'Amount' } });
    fireEvent.click(screen.getByText('Build the report'));
    expect(onAnswer).toHaveBeenCalledWith('q', [
      { id: 'group', question: 'Group by what?', answer: 'Region' },
      { id: 'total', question: 'Total of what?', answer: 'Amount' },
    ]);
  });

  it('drops the form once the questions are answered, and holds it while something runs', () => {
    const questions = [{ id: 'a', question: 'Sorted how?', suggestion: 'By date' }];
    draw({ messages: [msg({ id: 'q', role: 'assistant', text: 'One question.', clarify: { answered: true, questions } })], onAnswer: vi.fn() });
    expect(screen.queryByText('Build the report')).toBeNull();
    cleanup();
    draw({ messages: [msg({ id: 'q', role: 'assistant', text: 'One question.', clarify: { answered: false, questions } })], onAnswer: vi.fn(), isAnalyzing: true });
    expect((screen.getByText('Build the report') as HTMLButtonElement).disabled).toBe(true);
  });
});

/*
 * The chat holds the messages and the answers and nothing else (2026-11-04):
 * a reply carries no buttons of its own beyond a failed turn's retry and a
 * description's questions.
 */
describe('a clean chat', () => {
  // Copy is the one button a reply always has (2026-11-05); until then it had none.
  it('draws a reply as its words and its report, with Copy alone when nothing else is wired', () => {
    draw({ messages: [msg({ id: 'b', role: 'assistant', text: 'Built "scan" from the text OCR read.' })] });
    expect(screen.getByText('Built "scan" from the text OCR read.')).toBeTruthy();
    expect([...document.querySelectorAll('.wb-note button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Copy']);
  });

  it("offers editing and withdrawing on the person's messages, never on Forma's", () => {
    draw({
      messages: [msg({ id: 'u', role: 'user', text: 'a sales report' }), msg({ id: 'a', role: 'assistant', text: 'Built it.' })],
      onEdit: vi.fn(),
      onWithdraw: vi.fn(),
    });
    const [mine, forma] = document.querySelectorAll('.wb-note');
    expect([...mine.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Edit', 'Withdraw']);
    expect(within(forma as HTMLElement).queryByText('Edit')).toBeNull();
    expect(within(forma as HTMLElement).queryByText('Withdraw')).toBeNull();
  });
});

/* Copy, the rating and Try again under Forma's replies (2026-11-05). */
describe("actions on Forma's replies", () => {
  const thread = [
    msg({ id: 'u1', role: 'user', text: 'hello' }),
    msg({ id: 'a1', role: 'assistant', text: 'Hi.' }),
    msg({ id: 'u2', role: 'user', text: 'an invoice' }),
    msg({ id: 'a2', role: 'assistant', text: 'Built **it**.' }),
  ];
  const actions = (id: string) => [...document.querySelectorAll('.wb-note')][thread.findIndex((m) => m.id === id)].querySelector('[role="group"][aria-label="This reply"]') as HTMLElement;

  it('offers Copy, the rating and Try again on every reply, showing them without pointing only on the latest', () => {
    draw({ messages: thread, onRegenerate: vi.fn(), onRate: vi.fn() });
    expect([...actions('a2').querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Copy', 'Good reply', 'Bad reply', 'Try again']);
    expect(actions('a2').className).not.toContain('wb-note-actions--quiet');
    expect(actions('a1').className).toContain('wb-note-actions--quiet');
  });

  it("copies the reply's own words, Markdown and all, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    draw({ messages: thread });
    fireEvent.click(within(actions('a2')).getByLabelText('Copy'));
    expect(writeText).toHaveBeenCalledWith('Built **it**.');
    expect(await within(actions('a2')).findByLabelText('Copied')).toBeTruthy();
  });

  it('rates a reply, and takes the rating back when the same is chosen again', () => {
    const onRate = vi.fn();
    const { rerender } = draw({ messages: thread, onRate });
    fireEvent.click(within(actions('a1')).getByLabelText('Bad reply'));
    expect(onRate).toHaveBeenLastCalledWith('a1', 'bad');
    const rated = thread.map((m) => (m.id === 'a1' ? { ...m, rating: 'bad' as const } : m));
    rerender(<ChatThread messages={rated} isChatting={false} isAnalyzing={false} streamingReply="" onRetry={vi.fn()} onOpenAttachment={vi.fn()} onRate={onRate} />);
    expect(within(actions('a1')).getByLabelText('Bad reply').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(actions('a1')).getByLabelText('Bad reply'));
    expect(onRate).toHaveBeenLastCalledWith('a1', undefined);
  });

  // The chat's changes to the report can be taken back (2026-11-05).
  it('offers Undo only on a reply whose change can still be taken back, and says Undone after', () => {
    const onUndo = vi.fn();
    const { rerender } = draw({ messages: thread, undoable: new Set(['a2']), onUndo });
    expect(within(actions('a1')).queryByText('Undo')).toBeNull();
    fireEvent.click(within(actions('a2')).getByText('Undo'));
    expect(onUndo).toHaveBeenCalledWith('a2');
    const undone = thread.map((m) => (m.id === 'a2' ? { ...m, undone: true as const } : m));
    rerender(<ChatThread messages={undone} isChatting={false} isAnalyzing={false} streamingReply="" onRetry={vi.fn()} onOpenAttachment={vi.fn()} undoable={new Set()} onUndo={onUndo} />);
    expect(within(actions('a2')).queryByText('Undo')).toBeNull();
    expect(within(actions('a2')).getByText('Undone')).toBeTruthy();
  });

  // A redesign asked before it is made (2026-11-05).
  it('asks before a redesign with Redesign and Not now, and says Not redesigned after a no', () => {
    const onConfirm = vi.fn();
    const asking = [msg({ id: 'u', text: 'add a chart' }), msg({ id: 'a', role: 'assistant', text: 'Forma would redesign it.', confirm: { prompt: 'add a chart' } })];
    const { rerender } = draw({ messages: asking, onConfirm });
    const group = screen.getByRole('group', { name: 'Redesign the report?' });
    fireEvent.click(within(group).getByText('Redesign'));
    expect(onConfirm).toHaveBeenCalledWith('a', true);
    fireEvent.click(within(group).getByText('Not now'));
    expect(onConfirm).toHaveBeenLastCalledWith('a', false);
    const answered = asking.map((m) => (m.id === 'a' ? { ...m, confirm: { prompt: 'add a chart', answered: 'no' as const } } : m));
    rerender(<ChatThread messages={answered} isChatting={false} isAnalyzing={false} streamingReply="" onRetry={vi.fn()} onOpenAttachment={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.queryByRole('group', { name: 'Redesign the report?' })).toBeNull();
    expect(screen.getByText('Not redesigned')).toBeTruthy();
  });

  it('asks for the reply to be written again by its own id, and holds that while something runs', () => {
    const onRegenerate = vi.fn();
    const { unmount } = draw({ messages: thread, onRegenerate });
    fireEvent.click(within(actions('a1')).getByLabelText('Try again'));
    expect(onRegenerate).toHaveBeenCalledWith('a1');
    unmount();
    draw({ messages: thread, onRegenerate, isChatting: true });
    expect((within(actions('a2')).getByLabelText('Try again') as HTMLButtonElement).disabled).toBe(true);
  });
});

/** A sent message, edited or withdrawn (2026-11-04). */
describe('editing and withdrawing a message', () => {
  const thread = [msg({ id: 'u', role: 'user', text: 'a sales report' }), msg({ id: 'a', role: 'assistant', text: 'Built it.' })];

  it('edits in place and sends the changed text for that message', () => {
    const onEdit = vi.fn();
    draw({ messages: thread, onEdit, onWithdraw: vi.fn() });
    fireEvent.click(screen.getByText('Edit'));
    const box = screen.getByLabelText('Edit your message') as HTMLTextAreaElement;
    expect(box.value).toBe('a sales report');
    fireEvent.change(box, { target: { value: 'a sales report by region' } });
    fireEvent.click(screen.getByText('Send'));
    expect(onEdit).toHaveBeenCalledWith('u', 'a sales report by region');
    expect(screen.queryByLabelText('Edit your message')).toBeNull();
  });

  it('sends nothing for unchanged text, and Escape puts the message back', () => {
    const onEdit = vi.fn();
    draw({ messages: thread, onEdit });
    fireEvent.click(screen.getByText('Edit'));
    expect((screen.getByText('Send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Escape' });
    expect(screen.getByText('a sales report')).toBeTruthy();
  });

  it('does not offer editing a message sent with pictures, which an edit would not send again', () => {
    draw({ messages: [msg({ id: 'u', text: 'this scan', images: ['data:image/png;base64,AA'] })], onEdit: vi.fn(), onWithdraw: vi.fn() });
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.getByText('Withdraw')).toBeTruthy();
  });

  it('withdraws only once asked twice, and Keep changes nothing', () => {
    const onWithdraw = vi.fn();
    draw({ messages: thread, onWithdraw });
    fireEvent.click(screen.getByText('Withdraw'));
    expect(screen.getByText("Withdraw this message and Forma's answer?")).toBeTruthy();
    fireEvent.click(screen.getByText('Keep'));
    expect(onWithdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Withdraw'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Withdraw this message' })).getByText('Withdraw'));
    expect(onWithdraw).toHaveBeenCalledWith('u');
  });

  it('holds both while something runs', () => {
    draw({ messages: thread, onEdit: vi.fn(), onWithdraw: vi.fn(), isChatting: true });
    expect((screen.getByText('Edit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Withdraw') as HTMLButtonElement).disabled).toBe(true);
  });
});

/* Forma's replies as Markdown, the person's words as typed (2026-11-05). */
describe('what a message says', () => {
  // The renderer is lazy, and its cold import (micromark and all) took longer
  // than findBy's one second when the first case paid for it; testing.md's
  // "a timeout in only the first case" is this trap.
  beforeAll(async () => {
    await import('./Markdown');
  });

  it("draws Forma's reply as Markdown", async () => {
    draw({ messages: [msg({ id: 'a', role: 'assistant', text: 'Added **two** totals:\n\n- Balance\n- `Count`' })] });
    expect((await screen.findByText('two')).tagName).toBe('STRONG');
    expect([...document.querySelectorAll('.wb-md li')].map((li) => li.textContent)).toEqual(['Balance', 'Count']);
    expect(document.querySelector('.wb-md code')?.textContent).toBe('Count');
  });

  it('opens a link in a reply in a new tab, away from the unsaved report', async () => {
    draw({ messages: [msg({ id: 'a', role: 'assistant', text: 'See [the docs](https://docs.devexpress.com/).' })] });
    const link = await screen.findByRole('link', { name: 'the docs' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it("keeps the person's words as typed, line breaks and asterisks included", () => {
    draw({ messages: [msg({ id: 'u', role: 'user', text: 'Which paper? A4\n**not** Letter' })] });
    const p = document.querySelector('.wb-note--me .wb-plain')!;
    expect(p.textContent).toBe('Which paper? A4\n**not** Letter');
    expect(document.querySelector('.wb-note--me strong')).toBeNull();
  });

  it('draws a reply plain while a search marks its matches', () => {
    draw({ messages: [msg({ id: 'a', role: 'assistant', text: 'Added **two** totals' })], query: 'two' });
    expect(document.querySelector('.wb-md')).toBeNull();
    expect(document.querySelector('mark.wb-hit')?.textContent).toBe('two');
  });
});

describe('searching the transcript', () => {
  const thread = [
    msg({ id: '1', role: 'user', text: 'an invoice with totals' }),
    msg({ id: '2', role: 'assistant', text: 'Built the invoice.' }),
    msg({ id: '3', role: 'user', text: 'move the logo' }),
  ];

  it('draws only the messages holding the query, each match marked', () => {
    draw({ messages: thread, query: 'INVOICE' });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(2);
    expect([...document.querySelectorAll('mark.wb-hit')].map((m) => m.textContent)).toEqual(['invoice', 'invoice']);
    expect(screen.getByRole('status').textContent).toBe('2 of 3 messages');
  });

  it('says so when nothing holds it', () => {
    draw({ messages: thread, query: 'chart' });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('No message holds that.');
  });

  it('draws everything, unmarked, with no query', () => {
    draw({ messages: thread, query: '' });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(3);
    expect(document.querySelectorAll('mark')).toHaveLength(0);
  });
});