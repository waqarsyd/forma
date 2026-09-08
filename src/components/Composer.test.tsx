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

const field = () => screen.getByLabelText('Describe a change') as HTMLInputElement;
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
    ['there is no key', { hasApiKey: false }],
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

  it('refuses with no key, and says so in the placeholder', () => {
    draw({ hasApiKey: false });
    expect(send().disabled).toBe(true);
    expect(field().disabled).toBe(true);
    expect(field().placeholder).toBe('Add your API key to start');
  });

  it('is ready when a key is present and nothing is in flight', () => {
    draw();
    expect(send().disabled).toBe(false);
    expect(field().disabled).toBe(false);
    expect(field().placeholder).toBe('Describe a change…');
  });
});

describe('the key gate', () => {
  it('offers the way in when there is no key', () => {
    draw({ hasApiKey: false });
    expect(screen.getByText('Add your Gemini API key')).toBeTruthy();
    expect(document.querySelector('.wb-box')!.className).toContain('wb-is-locked');
  });

  it('opens the config dialog when asked', () => {
    const onAddKey = vi.fn();
    draw({ hasApiKey: false, onAddKey });
    fireEvent.click(screen.getByText('Add your Gemini API key').closest('button')!);
    expect(onAddKey).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way once a key is present', () => {
    draw();
    expect(screen.queryByText('Add your Gemini API key')).toBeNull();
    expect(document.querySelector('.wb-box')!.className).not.toContain('wb-is-locked');
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
