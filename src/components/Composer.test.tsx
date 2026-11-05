// @vitest-environment jsdom
/**
 * The composer.
 *
 * Written before `App.tsx` was switched over to it, as with `ChatThread`.
 *
 * Most of this file is about the two hazards the extracted markup carries
 * comments about, because both are invisible and both have bitten before: the
 * send button must be *wrapped* rather than handed `onSend` directly, or the
 * click event arrives as the prompt override; and Enter sends while Shift+Enter
 * must not. The rest pins the key gate, which is the one piece of UI standing
 * between a first-time visitor and a request that cannot succeed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { createRef, useState } from 'react';
import Composer from './Composer';
import type { AttachmentGroup, PreviewMeta } from '../lib/attachments';

afterEach(cleanup);

const group = (file: string, indices: number[]): AttachmentGroup => ({
  file,
  indices,
  pages: indices.length,
});

const draw = (props: Partial<React.ComponentProps<typeof Composer>> = {}) =>
  render(
    <Composer
      previews={[]}
      previewGroups={[]}
      previewMeta={[]}
      textGroups={[]}
      onOpenAttachment={vi.fn()}
      onRemoveFile={vi.fn()}
      onRemoveText={vi.fn()}
      uploadNotices={[]}
      error={null}
      prompt=""
      onPromptChange={vi.fn()}
      onSend={vi.fn()}
      fileInputRef={createRef<HTMLInputElement>()}
      onFileChange={vi.fn()}
      hasApiKey
      isAnalyzing={false}
      isChatting={false}
      isIngesting={false}
      {...props}
    />
  );

const field = () => screen.getByLabelText('Message') as HTMLTextAreaElement;
const send = () => screen.getByLabelText('Send note') as HTMLButtonElement;

describe('sending', () => {
  it('sends on click', () => {
    const onSend = vi.fn();
    draw({ onSend });
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  /*
   * The hazard the markup carries a comment about. `onSend` is `handleGenerate`,
   * whose first parameter is an optional prompt override; handing it to onClick
   * bare passes React's synthetic click event as that override, which is truthy
   * and generates against an event object instead of the typed prompt. Asserting
   * "called with nothing" is what pins the wrapper in place.
   */
  it('calls onSend with no arguments, never the click event', () => {
    const onSend = vi.fn();
    draw({ onSend });
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledWith();
  });

  /*
   * `.wb-box` rings on :focus-within, so a click leaves the *button* focused —
   * and `canSend` disables that button while the request runs, which drops
   * focus to the document and never returns it. Found by pixel-diffing two runs
   * that looked identical to the eye.
   */
  it('puts the caret back in the field after a click, so focus is not lost when the button disables', () => {
    draw();
    fireEvent.click(send());
    expect(document.activeElement).toBe(field());
  });

  it('sends on Enter', () => {
    const onSend = vi.fn();
    draw({ onSend });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  // Shift+Enter is the multi-line affordance; sending on it would make a
  // deliberate line break fire the request instead.
  it('does not send on Shift+Enter', () => {
    const onSend = vi.fn();
    draw({ onSend });
    fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const onSend = vi.fn();
    draw({ onSend });
    fireEvent.keyDown(field(), { key: 'a' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('reports what was typed', () => {
    const onPromptChange = vi.fn();
    draw({ onPromptChange });
    fireEvent.change(field(), { target: { value: 'move the title' } });
    expect(onPromptChange).toHaveBeenCalledWith('move the title');
  });
});

/*
 * The button's `disabled` stops a click and does nothing at all about the
 * keyboard, because the keydown handler is on the input beside it. Every one of
 * these was reachable by pressing Enter while a request was already running,
 * which re-entered handleGenerate: a second generation writing to the same
 * progress state and the same refs as the first, or a second chat turn built
 * from a `messages` closure captured before the first one's reply landed.
 */
describe('Enter respects the same conditions as the button', () => {
  const cases: Array<[string, Partial<React.ComponentProps<typeof Composer>>]> = [
    ['a generation is running', { isAnalyzing: true }],
    ['a chat turn is running', { isChatting: true }],
    ['an upload is still being read', { isIngesting: true }],
  ];

  for (const [what, props] of cases) {
    it(`does not send on Enter while ${what}`, () => {
      const onSend = vi.fn();
      draw({ ...props, onSend });
      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(onSend).not.toHaveBeenCalled();
    });

    it(`disables the button while ${what}`, () => {
      draw(props);
      expect(send().disabled).toBe(true);
    });
  }
});

describe('when sending is not possible', () => {
  it('refuses while a generation is running', () => {
    draw({ isAnalyzing: true });
    expect(send().disabled).toBe(true);
  });

  // Files are still being read and staged; sending now would send some of them.
  it('refuses while an upload is still being ingested', () => {
    draw({ isIngesting: true });
    expect(send().disabled).toBe(true);
  });

  // The key is the entry point again (2026-11-05): with none the box is
  // locked, as it was until 2026-11-02, and its button opens Settings.
  it('locks with no key, sends nothing, and offers the way to a key in place of the send', () => {
    const onSend = vi.fn();
    const onAddKey = vi.fn();
    draw({ hasApiKey: false, onSend, onAddKey });
    expect(field().disabled).toBe(true);
    expect(field().placeholder).toBe('Add your API key to start');
    expect(screen.getByRole('button', { name: 'Add photos and files' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Send note' })).toBeNull();
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add your API key' }));
    expect(onAddKey).toHaveBeenCalledTimes(1);
  });

  it('is ready when a key is present and nothing is in flight', () => {
    draw();
    expect(send().disabled).toBe(false);
    expect(field().disabled).toBe(false);
    // The owner's wording, 2026-11-05.
    expect(field().placeholder).toBe('What would you like to change or create?');
  });
});

/*
 * A clean composer (2026-11-04): the attach button, the box and the send,
 * and nothing under them. The "Working offline" banner and the key line
 * went, at the owner's request; Settings says both where the key is typed.
 * While a generation runs, the send is its Stop, as in other chat apps.
 */
describe('a clean composer', () => {
  it('draws nothing under the box, with or without a key', () => {
    for (const hasApiKey of [true, false]) {
      const { unmount } = draw({ hasApiKey });
      expect(screen.queryByText(/Working offline|Your key clears/)).toBeNull();
      expect(document.querySelector('.wb-box')!.nextElementSibling).toBeNull();
      unmount();
    }
  });

  it('turns the send into a Stop while a generation runs, and back', () => {
    const onStop = vi.fn();
    const { rerender } = draw({ isAnalyzing: true, onStop });
    expect(screen.queryByLabelText('Send note')).toBeNull();
    fireEvent.click(screen.getByLabelText('Stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    rerender(
      <Composer
        previews={[]}
        previewGroups={[]}
        previewMeta={[]}
        textGroups={[]}
        onOpenAttachment={vi.fn()}
        onRemoveFile={vi.fn()}
        onRemoveText={vi.fn()}
        uploadNotices={[]}
        error={null}
        prompt=""
        onPromptChange={vi.fn()}
        onSend={vi.fn()}
        onStop={onStop}
        fileInputRef={createRef<HTMLInputElement>()}
        onFileChange={vi.fn()}
        hasApiKey
        isAnalyzing={false}
        isChatting={false}
        isIngesting={false}
      />,
    );
    expect(screen.queryByLabelText('Stop')).toBeNull();
    expect(send().disabled).toBe(false);
  });

  // The model in the box, as Gemini's (2026-11-05), named as Stitch's tiers since that evening.
  it("shows the model, lists Auto, Fast and Balanced with the model behind each and today's requests, and hands up the choice", () => {
    const onChoose = vi.fn();
    draw({ models: { current: '', choices: [{ id: 'gemini-2.5-flash', used: 7 }, { id: 'gemini-2.5-flash-lite', used: 0 }], onChoose } });
    const pick = screen.getByTitle('The model the chat and reports use');
    expect(pick.textContent).toBe('Auto');
    fireEvent.click(pick);
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      'AutoForma picks the best model your key can use.',
      'FastGemini 2.5 Flash-Lite. Quick answers and edits. 0 today.',
      'BalancedGemini 2.5 Flash. New reports and redesigns. 7 today.',
    ]);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(items[2]);
    expect(onChoose).toHaveBeenCalledWith('gemini-2.5-flash');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // The queue (2026-11-05), as Stitch's tray over its box.
  it('queues what is sent while Forma works, by Enter or by the button', () => {
    const onQueue = vi.fn();
    const onSend = vi.fn();
    draw({ isChatting: true, prompt: 'Then centre the note', onQueue, onSend, onStop: vi.fn() });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onQueue).toHaveBeenCalledWith('Then centre the note');
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(onQueue).toHaveBeenCalledTimes(2);
  });

  it('lists the queue over the box with Steer, Edit and Cancel, and stops while the box is empty', () => {
    const onSteer = vi.fn();
    const onEditQueued = vi.fn();
    const onCancelQueued = vi.fn();
    draw({ isAnalyzing: true, onStop: vi.fn(), onQueue: vi.fn(), queue: [{ id: 'q1', text: 'Make the total bold' }], onSteer, onEditQueued, onCancelQueued });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('Make the total bold');
    fireEvent.click(screen.getByRole('button', { name: /Steer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([onSteer, onEditQueued, onCancelQueued].map((f) => f.mock.calls[0][0])).toEqual(['q1', 'q1', 'q1']);
  });

  // ↑ in an empty box brings back earlier messages (2026-11-05).
  it('brings back earlier messages with the up arrow in an empty box, and goes forward with the down arrow', () => {
    function Box() {
      const [prompt, setPrompt] = useState('');
      return (
        <Composer
          previews={[]} previewGroups={[]} previewMeta={[]} textGroups={[]}
          onOpenAttachment={vi.fn()} onRemoveFile={vi.fn()} onRemoveText={vi.fn()} uploadNotices={[]} error={null}
          prompt={prompt} onPromptChange={setPrompt} onSend={vi.fn()} fileInputRef={createRef<HTMLInputElement>()} onFileChange={vi.fn()}
          hasApiKey isAnalyzing={false} isChatting={false} isIngesting={false} history={['first', 'second']}
        />
      );
    }
    render(<Box />);
    const press = (key: string) => fireEvent.keyDown(field(), { key });
    press('ArrowUp');
    expect(field().value).toBe('second');
    press('ArrowUp');
    expect(field().value).toBe('first');
    press('ArrowDown');
    expect(field().value).toBe('second');
    press('ArrowDown');
    expect(field().value).toBe('');
  });

  it('leaves the up arrow to the text while the box holds what was typed', () => {
    const onPromptChange = vi.fn();
    draw({ prompt: 'typing', onPromptChange, history: ['first'] });
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(onPromptChange).not.toHaveBeenCalled();
  });

  it('names a chosen tier in the box', () => {
    draw({ models: { current: 'gemini-2.5-flash-lite', choices: [{ id: 'gemini-2.5-flash', used: 7 }, { id: 'gemini-2.5-flash-lite', used: 0 }], onChoose: () => {} } });
    expect(screen.getByTitle('The model the chat and reports use').textContent).toBe('Fast');
  });

  it('offers no model picker for another AI', () => {
    draw({ models: null });
    expect(screen.queryByTitle('The model the chat and reports use')).toBeNull();
  });

  // A spoken message (2026-11-05), as ChatGPT's and Gemini's boxes take one.
  it('offers the microphone only where the browser hears speech, and writes what it hears after what was typed', () => {
    expect(screen.queryByLabelText('Speak your message')).toBeNull();
    const made: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onresult: ((e: unknown) => void) | null; onend: (() => void) | null; lang: string }[] = [];
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = true;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      constructor() {
        made.push(this);
      }
    }
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    const onPromptChange = vi.fn();
    draw({ prompt: 'Make the title', onPromptChange });
    fireEvent.click(screen.getByLabelText('Speak your message'));
    expect(made).toHaveLength(1);
    expect(made[0].start).toHaveBeenCalled();
    expect(screen.getByLabelText('Stop listening').getAttribute('aria-pressed')).toBe('true');
    made[0].onresult?.({ results: [[{ transcript: 'bold and ' }], [{ transcript: 'blue' }]] });
    expect(onPromptChange).toHaveBeenLastCalledWith('Make the title bold and blue');
    fireEvent.click(screen.getByLabelText('Stop listening'));
    expect(made[0].stop).toHaveBeenCalled();
    act(() => made[0].onend?.());
    expect(screen.getByLabelText('Speak your message').getAttribute('aria-pressed')).toBe('false');
    vi.unstubAllGlobals();
  });

  // What is selected on the Preview is what "this" means (2026-11-05).
  it('shows the controls selected on the Preview above the box, and nothing with none', () => {
    const { rerender } = draw({ selection: ['title'] });
    expect(screen.getByRole('status').textContent).toBe('title');
    rerender(
      <Composer previews={[]} previewGroups={[]} previewMeta={[]} textGroups={[]} onOpenAttachment={vi.fn()} onRemoveFile={vi.fn()} onRemoveText={vi.fn()} uploadNotices={[]} error={null} prompt="" onPromptChange={vi.fn()} onSend={vi.fn()} fileInputRef={createRef<HTMLInputElement>()} onFileChange={vi.fn()} hasApiKey isAnalyzing={false} isChatting={false} isIngesting={false} selection={['title', 'total']} />,
    );
    expect(screen.getByRole('status').textContent).toBe('2 controls: title, total');
    rerender(
      <Composer previews={[]} previewGroups={[]} previewMeta={[]} textGroups={[]} onOpenAttachment={vi.fn()} onRemoveFile={vi.fn()} onRemoveText={vi.fn()} uploadNotices={[]} error={null} prompt="" onPromptChange={vi.fn()} onSend={vi.fn()} fileInputRef={createRef<HTMLInputElement>()} onFileChange={vi.fn()} hasApiKey isAnalyzing={false} isChatting={false} isIngesting={false} />,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  // A reply being written can be stopped too (2026-11-05), as ChatGPT's can.
  it('turns the send into a Stop while a reply is written', () => {
    const onStop = vi.fn();
    draw({ isChatting: true, onStop });
    expect(screen.queryByLabelText('Send note')).toBeNull();
    fireEvent.click(screen.getByLabelText('Stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('staged attachments', () => {
  it('shows one chip per upload, with a page count for a multi-page file', () => {
    draw({
      previews: ['data:image/png;base64,A', 'data:image/png;base64,B'],
      previewGroups: [group('invoice.pdf', [0, 1])],
      previewMeta: [
        { uploadId: 'u1', file: 'invoice.pdf', page: 1 },
        { uploadId: 'u1', file: 'invoice.pdf', page: 2 },
      ] as PreviewMeta[],
    });
    expect(document.querySelectorAll('.wb-attach--file')).toHaveLength(1);
    expect(screen.getByText('2 pages')).toBeTruthy();
  });

  it('omits the page count for a single image', () => {
    draw({
      previews: ['data:image/png;base64,A'],
      previewGroups: [group('shot.png', [0])],
      previewMeta: [{ uploadId: 'u1', file: 'shot.png' }] as PreviewMeta[],
    });
    expect(screen.queryByText(/pages/)).toBeNull();
  });

  it('removes an upload by its whole group, not one page', () => {
    const onRemoveFile = vi.fn();
    draw({
      onRemoveFile,
      previews: ['data:image/png;base64,A', 'data:image/png;base64,B'],
      previewGroups: [group('invoice.pdf', [0, 1])],
      previewMeta: [
        { uploadId: 'u1', file: 'invoice.pdf', page: 1 },
        { uploadId: 'u1', file: 'invoice.pdf', page: 2 },
      ] as PreviewMeta[],
    });
    fireEvent.click(screen.getByLabelText('Remove invoice.pdf · 2 pages'));
    expect(onRemoveFile).toHaveBeenCalledWith([0, 1], 'u1');
  });

  // A .repx has no thumbnail, so it gets the second row rather than being
  // dropped for having no image.
  it('lists a text-only upload in its own row', () => {
    draw({ textGroups: [{ ...group('legacy.repx', [0]), uploadId: 'u9' }] });
    expect(screen.getByText('legacy.repx')).toBeTruthy();
  });

  it('removes a text-only upload by its upload id', () => {
    const onRemoveText = vi.fn();
    draw({
      onRemoveText,
      textGroups: [{ ...group('legacy.repx', [0]), uploadId: 'u9' }],
    });
    fireEvent.click(screen.getByLabelText('Remove legacy.repx'));
    expect(onRemoveText).toHaveBeenCalledWith('u9');
  });

  it('draws no chip rows when nothing is staged', () => {
    draw();
    expect(document.querySelector('.wb-chip-row')).toBeNull();
  });
});

describe('notices', () => {
  it('joins several upload notices into one line', () => {
    draw({ uploadNotices: ['one.gif is not supported', 'huge.pdf is too large'] });
    expect(screen.getByText('one.gif is not supported · huge.pdf is too large')).toBeTruthy();
  });

  it('reports an error as an alert', () => {
    draw({ error: 'Add your Gemini API key to use the workspace.' });
    expect(screen.getByRole('alert').textContent).toContain('Add your Gemini API key');
  });

  it('shows no notice lines when there is nothing to say', () => {
    draw();
    expect(document.querySelector('.wb-note-line')).toBeNull();
  });
});

/*
 * One box for everything (2026-11-01): the Describe-a-report and OCR buttons
 * went into it, and a pasted image is attached. Since 2026-11-03 an attached
 * image's chip shows the file and nothing else, and the send is never held
 * for it: its text is read after the message goes, behind the scenes, as the
 * owner asked for the chat to work like other chat apps.
 */
describe('one chat box', () => {
  const group = (file: string, i: number): AttachmentGroup => ({ file, indices: [i], pages: 1 });
  const withImage = (props: Partial<React.ComponentProps<typeof Composer>> = {}) =>
    draw({ previews: ['data:image/png;base64,AAAA'], previewGroups: [group('scan.png', 0)], previewMeta: [{ uploadId: 'u1', file: 'scan.png' }], ...props });

  it('has no separate Describe or OCR button', () => {
    withImage();
    expect(screen.queryByLabelText('Describe a report')).toBeNull();
    expect(screen.queryByLabelText('Read text with OCR')).toBeNull();
  });

  it("shows an attached image as the file alone, and sends it at once", () => {
    const onSend = vi.fn();
    withImage({ onSend });
    const chip = document.querySelector('.wb-attach--file') as HTMLElement;
    expect(chip.textContent).toBe('scan.png');
    expect(chip.querySelectorAll('button')).toHaveLength(2);
    expect(screen.queryByText(/Reading text|Text read|Text not read/)).toBeNull();
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('attaches an image pasted into the box, and leaves pasted text alone', () => {
    const onPasteFiles = vi.fn();
    draw({ onPasteFiles });
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(field(), { clipboardData: { files: [file] } });
    expect(onPasteFiles).toHaveBeenCalledWith([file]);
    fireEvent.paste(field(), { clipboardData: { files: [] } });
    expect(onPasteFiles).toHaveBeenCalledTimes(1);
  });
});