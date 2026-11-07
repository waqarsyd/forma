// @vitest-environment jsdom
/**
 * The conversation a request at a time (2026-11-05), as Google Stitch's agent
 * card shows it: what was asked in a pill at the top, Forma's replies under
 * it, and a mark that folds the card away. `requestsOf` in chatSession.test.ts
 * proves the grouping; this proves what the card draws from one request.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RequestCard from './RequestCard';
import type { PreviewMeta } from '../lib/attachments';
import type { ChatMessage, ChatRequest } from '../lib/chatSession';

afterEach(cleanup);
// The replies' Markdown renderer is lazy; pay for its import outside a test's budget.
beforeAll(async () => {
  await import('./Markdown');
}, 60_000);

type Msg = ChatMessage<unknown, PreviewMeta>;
const ask: Msg = { id: 'q1', role: 'user', text: 'Make the total bold\nand right-align the amounts' };
const reply: Msg = { id: 'r1', role: 'assistant', text: 'Both are changed in place.' };
const request: ChatRequest<unknown, PreviewMeta> = { id: 'q1', ask, replies: [reply] };

const draw = (props: Partial<React.ComponentProps<typeof RequestCard<unknown>>> = {}) =>
  render(
    <RequestCard<unknown>
      request={request}
      latest
      collapsed={false}
      onToggle={() => {}}
      isChatting={false}
      isAnalyzing={false}
      streamingReply=""
      onRetry={() => {}}
      onOpenAttachment={() => {}}
      {...props}
    />,
  );

describe('RequestCard', () => {
  it('pins what was asked in a pill, its first line until opened, with the reply under it', () => {
    draw();
    const pill = screen.getByText('Make the total bold');
    expect(pill.className).toContain('wb-ask-text');
    expect(screen.getByText('Both are changed in place.')).toBeTruthy();
    // The ask is the pill's, never a bubble of the thread as well.
    expect(document.querySelector('.wb-note--me')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole message' }));
    expect(screen.getByText(/and right-align the amounts/)).toBeTruthy();
  });

  it('folds to its mark, and the mark opens it again', () => {
    const onToggle = vi.fn();
    draw({ collapsed: true, onToggle });
    expect(screen.queryByText('Both are changed in place.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the reply' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('edits what was asked from the pill, and offers Try again when the turn failed', () => {
    const onEdit = vi.fn();
    const onRetry = vi.fn();
    draw({ onEdit, onRetry, request: { id: 'q1', ask: { ...ask, error: 'Google was busy.' }, replies: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledWith('q1');
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'Make the total red' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onEdit).toHaveBeenCalledWith('q1', 'Make the total red');
  });

  // Agent audit item 75: a project opening on its own report asked nothing to send again.
  it('offers Try again on a reply only when the request has a message to send again', () => {
    const { unmount } = draw({ onRegenerate: vi.fn() });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    unmount();
    draw({ onRegenerate: vi.fn(), request: { id: 'r1', ask: null, replies: [reply] } });
    expect(screen.getByText('Both are changed in place.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

/*
 * The pill's own controls (2026-11-04, and the pill's alone since 2026-11-06,
 * when the workspace audit removed the thread's copy of them, which the card
 * never reached). Moved here from ChatThread.test.tsx with them.
 */
describe("the pill's edit, withdraw and versions", () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Show the whole message' }));

  it('sends nothing for unchanged text, and Escape puts the message back', () => {
    const onEdit = vi.fn();
    draw({ onEdit });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Escape' });
    expect(screen.queryByLabelText('Edit your message')).toBeNull();
  });

  it('offers editing a message sent with pictures, which an edit sends again', () => {
    draw({ onEdit: vi.fn(), onWithdraw: vi.fn(), request: { id: 'q1', ask: { ...ask, images: ['data:image/png;base64,AA'] }, replies: [] } });
    open();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('shows which version of a message is showing, and asks for the one before or after', () => {
    const onShowVersion = vi.fn();
    const branches = [{ text: 'make it blue', tail: [] }, { text: 'make it green', tail: [] }, { text: 'make it red', tail: [] }];
    draw({ onShowVersion, request: { id: 'q1', ask: { ...ask, text: 'make it green', branches, branch: 1 }, replies: [] } });
    open();
    const versions = screen.getByRole('group', { name: 'Versions of this message' });
    expect(versions.textContent).toBe('2/3');
    fireEvent.click(screen.getByLabelText('Previous version'));
    expect(onShowVersion).toHaveBeenLastCalledWith('q1', 0);
    fireEvent.click(screen.getByLabelText('Next version'));
    expect(onShowVersion).toHaveBeenLastCalledWith('q1', 2);
  });

  it('draws no versions for a message that has only the one', () => {
    draw({ onShowVersion: vi.fn() });
    open();
    expect(screen.queryByRole('group', { name: 'Versions of this message' })).toBeNull();
  });

  it('withdraws only once asked twice, and Keep changes nothing', () => {
    const onWithdraw = vi.fn();
    draw({ onWithdraw });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(screen.getByText("Withdraw this message and Forma's answer?")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onWithdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' }).find((b) => b.closest('[aria-label="Withdraw this message"]'))!);
    expect(onWithdraw).toHaveBeenCalledWith('q1');
  });

  it('holds both while something runs', () => {
    draw({ onEdit: vi.fn(), onWithdraw: vi.fn(), isChatting: true });
    open();
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
