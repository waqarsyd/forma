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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
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
      saveNotice={null}
      prompt=""
      onPromptChange={vi.fn()}
      onSend={vi.fn()}
      fileInputRef={createRef<HTMLInputElement>()}
      onFileChange={vi.fn()}
      hasApiKey
      isAnalyzing={false}
      isChatting={false}
      isIngesting={false}
      onAddKey={vi.fn()}
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

  // Since 2026-11-02 a missing key no longer locks the box: Forma's own model
  // designs from words with no key, so only work in flight holds the send.
  it("sends with no key, to Forma's own model, and says so in the placeholder", () => {
    const onSend = vi.fn();
    draw({ hasApiKey: false, onSend });
    expect(send().disabled).toBe(false);
    expect(field().disabled).toBe(false);
    expect(field().placeholder).toBe('Describe a report or attach an image: Forma’s own model, no key needed');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('is ready when a key is present and nothing is in flight', () => {
    draw();
    expect(send().disabled).toBe(false);
    expect(field().disabled).toBe(false);
    expect(field().placeholder).toBe('Describe a report, attach or paste an image, or ask anything…');
  });
});

describe('the key gate', () => {
  it('says it is working offline when there is no key, and offers the key', () => {
    draw({ hasApiKey: false });
    expect(screen.getByText('Working offline, with Forma’s own model')).toBeTruthy();
    expect(screen.getByText('Add a free Gemini key for AI designs')).toBeTruthy();
    expect(document.querySelector('.wb-box')!.className).not.toContain('wb-is-locked');
  });

  it('opens the config dialog when asked', () => {
    const onAddKey = vi.fn();
    draw({ hasApiKey: false, onAddKey });
    fireEvent.click(screen.getByText('Working offline, with Forma’s own model').closest('button')!);
    expect(onAddKey).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way once a key is present', () => {
    draw();
    expect(screen.queryByText('Working offline, with Forma’s own model')).toBeNull();
  });

  // Whoever is about to paste a key is exactly who needs to know it is not
  // being stored, so this line shows in both states.
  it('promises the key clears, with or without one', () => {
    const { unmount } = draw();
    expect(screen.getByText('Your key clears when this tab closes')).toBeTruthy();
    unmount();
    draw({ hasApiKey: false });
    expect(screen.getByText('Your key clears when this tab closes')).toBeTruthy();
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

  it('reports a save as a status, not an alert', () => {
    draw({ saveNotice: 'Saved to your account.' });
    expect(screen.getByRole('status').textContent).toContain('Saved to your account.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows no notice lines when there is nothing to say', () => {
    draw();
    expect(document.querySelector('.wb-note-line')).toBeNull();
  });
});

/*
 * One box for everything (2026-11-01): the Describe-a-report and OCR buttons
 * went into it. An image's text is read as it is attached, its chip saying
 * how far it has got and opening the review once read; the send waits for
 * the reading, as any chat's waits for an upload; a pasted image is attached.
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

  it('shows each image\'s reading on its chip, and holds the send until it is read', () => {
    withImage({ ocrStatus: { u1: { state: 'reading', progress: 0.42 } } });
    expect(screen.getByText('Reading text 42%')).toBeTruthy();
    expect(send().disabled).toBe(true);
    expect(send().title).toBe('Reading the text of your image…');
    cleanup();
    const onReviewOcr = vi.fn();
    withImage({ ocrStatus: { u1: { state: 'done', lines: 12, flagged: 2 } }, onReviewOcr });
    expect(send().disabled).toBe(false);
    fireEvent.click(screen.getByText('Text read, 2 unsure'));
    expect(onReviewOcr).toHaveBeenCalledWith('u1');
    cleanup();
    withImage({ ocrStatus: { u1: { state: 'failed' } } });
    expect(send().disabled).toBe(false);
    expect((screen.getByText('Text not read').closest('button') as HTMLButtonElement).disabled).toBe(true);
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