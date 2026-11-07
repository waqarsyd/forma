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
 * proves what those rules look like on screen. Since 2026-11-07 (agent audit
 * item 61) the thread draws Forma's replies only: the person's message, its
 * pictures and its failure are the card's pill, and their tests moved to
 * RequestCard.test.tsx with them.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import ChatThread from './ChatThread';
import type { PreviewMeta } from '../lib/attachments';
import type { ChatMessage } from '../lib/chatSession';

afterEach(cleanup);

type Msg = ChatMessage<unknown, PreviewMeta>;

const msg = (over: Partial<Msg> & { id: string }): Msg => ({
  role: 'assistant',
  text: '',
  ...over,
});

const draw = (props: Partial<React.ComponentProps<typeof ChatThread<unknown>>> = {}) =>
  render(
    <ChatThread
      messages={[]}
      isChatting={false}
      isAnalyzing={false}
      streamingReply=""
      {...props}
    />
  );

describe('who said it', () => {
  it("names a reply Forma's", () => {
    draw({ messages: [msg({ id: '2', text: 'done' })] });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(1);
    expect(screen.getByText('Forma')).toBeTruthy();
    expect(screen.queryByText('You')).toBeNull();
  });

  // A generation pushes an assistant message whose text is empty when the model
  // returned only a result. An empty <p> there is a visible gap in the column.
  it('renders no paragraph for a message with no text', () => {
    draw({ messages: [msg({ id: '1', text: '' })] });
    expect(document.querySelector('.wb-note p')).toBeNull();
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
  it('asks for a reply again through the newest handler, not the one it first received', () => {
    const first = vi.fn();
    const second = vi.fn();
    const messages = [msg({ id: '1', text: 'done' })];
    const props = { messages, isChatting: false, isAnalyzing: false, streamingReply: '' };

    const { rerender } = render(<ChatThread {...props} onRegenerate={first} />);
    // Same message objects, new callback: what a re-render of App.tsx
    // produces when only the composer's prompt changed.
    rerender(<ChatThread {...props} onRegenerate={second} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('1');
  });

  it('redraws a row when its own message changes', () => {
    const props = { isChatting: false, isAnalyzing: false, streamingReply: '' };
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
  it('shows working dots before the first token arrives, with the task in words', () => {
    draw({ isChatting: true });
    const working = document.querySelector('.wb-working')!;
    expect(working.querySelectorAll('.wb-dots i')).toHaveLength(3);
    expect(working.textContent).toBe('Working on it…');
  });

  it('shows the text streamed so far once there is some', () => {
    draw({ isChatting: true, streamingReply: 'Forma supports PNG, JPG' });
    expect(screen.getByText('Forma supports PNG, JPG')).toBeTruthy();
    expect(document.querySelector('.wb-dots')).toBeNull();
  });

  // Agent audit item 7: a region mounted with its content is not announced, and a
  // streamed reply in one is read a few words at a time; the card's region speaks.
  it('is not a live region of its own, while it streams or while it waits', () => {
    const { rerender } = draw({ isChatting: true });
    expect(document.querySelector('[aria-live]')).toBeNull();
    rerender(<ChatThread messages={[]} isChatting isAnalyzing={false} streamingReply="Forma supports PNG" />);
    expect(document.querySelector('[aria-live]')).toBeNull();
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

  const base = { isChatting: false, isAnalyzing: false, streamingReply: '' };

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

  // Back to the latest message (2026-11-05), as ChatGPT and Gemini offer it.
  it('offers a way back to the latest message only while scrolled away from it', () => {
    render(<ChatThread {...base} messages={[msg({ id: '1', text: 'one' })]} />);
    expect(screen.queryByLabelText('Go to the latest message')).toBeNull();
    layout(thread(), 1000, 300, 120);
    fireEvent.scroll(thread());
    const back = screen.getByLabelText('Go to the latest message');
    const scrollTo = vi.fn();
    thread().scrollTo = scrollTo;
    fireEvent.click(back);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    expect(screen.queryByLabelText('Go to the latest message')).toBeNull();
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

  // One at a time since 2026-11-05, as Stitch's "Questions from Stitch" card.
  const three = msg({
    id: 'q',
    role: 'assistant',
    text: 'Before I design it, 3 questions.',
    clarify: { answered: false, questions: [
      { id: 'group', question: 'Group by what?', suggestion: 'Region' },
      { id: 'total', question: 'Total of what?' },
      { id: 'paper', question: 'Which paper?', suggestion: 'A4' },
    ] },
  });

  it('skips the rest to the summary, keeping the suggestions, and builds from there', () => {
    const onAnswer = vi.fn();
    draw({ messages: [three], onAnswer });
    fireEvent.click(screen.getByRole('button', { name: 'Skip the rest' }));
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Forma decides')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Build the report' }));
    expect(onAnswer.mock.calls[0][1].map((a: { answer: string }) => a.answer)).toEqual(['Region', '', 'A4']);
  });

  it('asks its questions one at a time, each holding its suggestion, then a summary, and hands up the answers', () => {
    const onAnswer = vi.fn();
    draw({ messages: [three], onAnswer });
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect((screen.getByLabelText('Group by what?') as HTMLInputElement).value).toBe('Region');
    expect(screen.queryByLabelText('Total of what?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Total of what?'), { target: { value: 'Amount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('3 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build the report' }));
    expect(onAnswer).toHaveBeenCalledWith('q', [
      { id: 'group', question: 'Group by what?', answer: 'Region' },
      { id: 'total', question: 'Total of what?', answer: 'Amount' },
      { id: 'paper', question: 'Which paper?', answer: 'A4' },
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

  // Agent audit item 59: Next swapped the field for another and focus fell to the page.
  it('moves the keyboard to the next question, its suggestion selected, and to Build the report at the summary, but not on first draw', () => {
    draw({ messages: [three], onAnswer: vi.fn() });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const total = screen.getByLabelText('Total of what?') as HTMLInputElement;
    expect(document.activeElement).toBe(total);
    fireEvent.click(screen.getByRole('button', { name: 'Skip the rest' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Build the report' }));
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

});

/* Copy, the rating and Try again under Forma's replies (2026-11-05). */
describe("actions on Forma's replies", () => {
  const thread = [
    msg({ id: 'a1', role: 'assistant', text: 'Hi.' }),
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

  // Agent audit item 56: on plain HTTP the browser has no clipboard, and Copy did nothing and said nothing.
  it('says so when the clipboard cannot be had', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    draw({ messages: thread });
    fireEvent.click(within(actions('a2')).getByLabelText('Copy'));
    expect(await within(actions('a2')).findByLabelText('Could not copy')).toBeTruthy();
  });

  it('rates a reply, and takes the rating back when the same is chosen again', () => {
    const onRate = vi.fn();
    const { rerender } = draw({ messages: thread, onRate });
    fireEvent.click(within(actions('a1')).getByLabelText('Bad reply'));
    expect(onRate).toHaveBeenLastCalledWith('a1', 'bad');
    const rated = thread.map((m) => (m.id === 'a1' ? { ...m, rating: 'bad' as const } : m));
    rerender(<ChatThread messages={rated} isChatting={false} isAnalyzing={false} streamingReply="" onRate={onRate} />);
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
    rerender(<ChatThread messages={undone} isChatting={false} isAnalyzing={false} streamingReply="" undoable={new Set()} onUndo={onUndo} />);
    expect(within(actions('a2')).queryByText('Undo')).toBeNull();
    expect(within(actions('a2')).getByText('Undone')).toBeTruthy();
  });

  // One history with the corner's (2026-11-07, agent audit item 52).
  it('offers Redo on a reply whose change was taken back, and drops Undone once the change is made again', () => {
    const onRedo = vi.fn();
    const undone = thread.map((m) => (m.id === 'a2' ? { ...m, undone: true as const } : m));
    const { rerender } = draw({ messages: undone, undoable: new Set(), onUndo: vi.fn(), redoable: new Set(['a2']), onRedo });
    expect(within(actions('a1')).queryByText('Redo')).toBeNull();
    fireEvent.click(within(actions('a2')).getByText('Redo'));
    expect(onRedo).toHaveBeenCalledWith('a2');
    // The corner's Redo made it again before the flag was cleared: Undo, not "Undone".
    rerender(<ChatThread messages={undone} isChatting={false} isAnalyzing={false} streamingReply="" undoable={new Set(['a2'])} onUndo={vi.fn()} redoable={new Set()} onRedo={onRedo} />);
    expect(within(actions('a2')).getByText('Undo')).toBeTruthy();
    expect(within(actions('a2')).queryByText('Undone')).toBeNull();
    expect(within(actions('a2')).queryByText('Redo')).toBeNull();
  });

  // Agent audit item 47, the owner's choice: an export or the designer is a button, run only when pressed.
  it('draws what a reply offers as buttons, and runs one only when it is pressed', () => {
    const onAction = vi.fn();
    const offering = [thread[0], msg({ id: 'a2', role: 'assistant', text: 'It is ready.', actions: [{ name: 'export', format: 'pdf' }, { name: 'designer' }] })];
    const { unmount } = draw({ messages: offering, onAction });
    const group = screen.getByRole('group', { name: 'Offered by this reply' });
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Export as PDF', 'Open in designer']);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByText('Open in designer'));
    expect(onAction).toHaveBeenCalledWith('a2', 1);
    unmount();
    draw({ messages: offering });
    expect(screen.queryByRole('group', { name: 'Offered by this reply' })).toBeNull();
  });

  // Agent audit item 75: a report built from the OCR review answers no message.
  it('offers no Try again on a reply Forma wrote of its own accord', () => {
    const own = [...thread, msg({ id: 'a3', role: 'assistant', text: 'Built "Invoice" from the text OCR read.', standalone: true })];
    draw({ messages: own, onRegenerate: vi.fn() });
    const notes = [...document.querySelectorAll('.wb-note')];
    const group = notes[2].querySelector('[role="group"][aria-label="This reply"]') as HTMLElement;
    expect(within(group).queryByLabelText('Try again')).toBeNull();
    expect(within(actions('a2')).getByLabelText('Try again')).toBeTruthy();
  });

  // When it was made and what it cost (2026-11-05), read off the id and from App.
  // The person's message says when it was sent on the card's pill (RequestCard.test.tsx).
  it('says when a reply was made and what it cost', () => {
    const at = new Date();
    at.setHours(10, 42, 0, 0);
    const id = `${at.getTime()}-1`;
    draw({
      messages: [msg({ id, role: 'assistant', text: 'Built it.' })],
      usageOf: (m) => (m.id === id ? '23.4k tokens' : null),
    });
    const metas = [...document.querySelectorAll('.wb-note-meta')].map((m) => m.textContent);
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatch(/^Today, .+ · 23\.4k tokens$/);
  });

  // A redesign asked before it is made (2026-11-05).
  it('asks before a redesign with Redesign and Not now, and says Not redesigned after a no', () => {
    const onConfirm = vi.fn();
    const asking = [msg({ id: 'a', role: 'assistant', text: 'Forma would redesign it.', confirm: { prompt: 'add a chart' } })];
    const { rerender } = draw({ messages: asking, onConfirm });
    const group = screen.getByRole('group', { name: 'Redesign the report?' });
    fireEvent.click(within(group).getByText('Redesign'));
    expect(onConfirm).toHaveBeenCalledWith('a', true);
    fireEvent.click(within(group).getByText('Not now'));
    expect(onConfirm).toHaveBeenLastCalledWith('a', false);
    const answered = asking.map((m) => (m.id === 'a' ? { ...m, confirm: { prompt: 'add a chart', answered: 'no' as const } } : m));
    rerender(<ChatThread messages={answered} isChatting={false} isAnalyzing={false} streamingReply="" onConfirm={onConfirm} />);
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

/* Editing and withdrawing a message, and its versions, are tested on the card's
   pill (RequestCard.test.tsx) since 2026-11-06: the thread's copy went. */

/* Forma's replies as Markdown (2026-11-05); the person's words are the card's pill. */
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

  it('draws a reply plain while a search marks its matches', () => {
    draw({ messages: [msg({ id: 'a', role: 'assistant', text: 'Added **two** totals' })], query: 'two' });
    expect(document.querySelector('.wb-md')).toBeNull();
    expect(document.querySelector('mark.wb-hit')?.textContent).toBe('two');
  });

  // Agent audit item 68: a code block has its own Copy, as ChatGPT's has.
  it('copies a code block whole from its own Copy, and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    draw({ messages: [msg({ id: 'a', role: 'assistant', text: 'Use this:\n\n```\nSum([Amount])\n```' })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the code' }));
    expect(writeText).toHaveBeenCalledWith('Sum([Amount])\n');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});

/*
 * The log's search, marked in the card (2026-11-07, agent audit item 30): the
 * card is one request, so hiding the replies that did not hold the words left
 * a request the log had found by its question saying "No message holds that".
 */
describe('searching the requests', () => {
  const thread = [
    msg({ id: '2', role: 'assistant', text: 'Built the invoice.' }),
    msg({ id: '4', role: 'assistant', text: 'Moved the logo.' }),
  ];

  it('marks the replies holding the query and hides none', () => {
    draw({ messages: thread, query: 'INVOICE' });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(2);
    expect([...document.querySelectorAll('mark.wb-hit')].map((m) => m.textContent)).toEqual(['invoice']);
    expect(screen.getByRole('status').textContent).toBe('1 reply holds that');
  });

  it('says nothing when no reply holds it, which the question asked may', () => {
    draw({ messages: thread, query: 'chart' });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(2);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelectorAll('mark')).toHaveLength(0);
  });

  it('draws everything, unmarked, with no query', () => {
    draw({ messages: thread, query: '' });
    expect(document.querySelectorAll('.wb-note')).toHaveLength(2);
    expect(document.querySelectorAll('mark')).toHaveLength(0);
  });
});
