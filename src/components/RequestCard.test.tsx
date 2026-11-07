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
    expect((document.querySelector('.wb-reply-body') as HTMLElement).hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show the reply' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // Agent audit item 32: a fold hid the card by dropping it, and with it an edit being typed.
  it('keeps an edit being typed over a fold', () => {
    const { rerender } = draw({ onEdit: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'Make the total red' } });
    const props = { request, latest: true, onToggle: () => {}, isChatting: false, isAnalyzing: false, streamingReply: '', onRetry: () => {}, onOpenAttachment: () => {}, onEdit: vi.fn() };
    rerender(<RequestCard<unknown> {...props} collapsed />);
    rerender(<RequestCard<unknown> {...props} collapsed={false} />);
    expect((screen.getByLabelText('Edit your message') as HTMLTextAreaElement).value).toBe('Make the total red');
  });

  it('edits what was asked from the pill, and offers Try again when the turn failed', () => {
    const onEdit = vi.fn();
    const onRetry = vi.fn();
    draw({ onEdit, onRetry, request: { id: 'q1', ask: { ...ask, error: 'Google was busy.' }, replies: [] } });
    expect(screen.getByRole('alert').textContent).toContain('Google was busy.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledWith('q1');
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

  // Moved from ChatThread.test.tsx with the branch (agent audit item 61).
  it('refuses a retry while something runs', () => {
    draw({ isAnalyzing: true, request: { id: 'q1', ask: { ...ask, error: 'failed' }, replies: [] } });
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // Agent audit item 61: the pill showed no time; the thread's never reached the card.
  it('says when the message was sent', () => {
    const at = new Date();
    at.setHours(10, 42, 0, 0);
    draw({ request: { id: 'q1', ask: { ...ask, id: `${at.getTime()}-0` }, replies: [reply] } });
    expect(screen.getByRole('group', { name: 'Your message' }).querySelector('.wb-note-meta')?.textContent).toMatch(/^Today, /);
  });

  // Moved from ChatThread.test.tsx: pages of one upload are one thumbnail, and the viewer gets them all.
  it('shows the pictures sent, a file of pages as one, and opens all its pages', () => {
    const onOpenAttachment = vi.fn();
    const pages = ['data:image/png;base64,A', 'data:image/png;base64,B', 'data:image/png;base64,C'];
    const imageMeta = [1, 2, 3].map((page) => ({ uploadId: 'u1', file: 'invoice.pdf', page }));
    draw({ onOpenAttachment, request: { id: 'q1', ask: { ...ask, images: [...pages, 'data:image/png;base64,D'], imageMeta: [...imageMeta, { uploadId: 'u2', file: 'invoice.pdf' }] }, replies: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole message and its pictures' }));
    const shots = document.querySelectorAll('.wb-attach-shot');
    expect(shots).toHaveLength(2);
    expect(shots[0].getAttribute('aria-label')).toBe('View invoice.pdf · 3 pages');
    fireEvent.click(shots[0]);
    expect(onOpenAttachment).toHaveBeenCalledWith({ srcs: pages, index: 0, file: 'invoice.pdf' });
  });

  // Agent audit item 7: one region, mounted empty and kept, says when Forma starts and what came of it.
  it('announces when Forma starts and what came of the request, once it ends', () => {
    const asked: typeof request = { id: 'q1', ask, replies: [] };
    const props = { latest: true, collapsed: false, onToggle: () => {}, isAnalyzing: false, streamingReply: '', onRetry: () => {}, onOpenAttachment: () => {} };
    const { rerender } = render(<RequestCard<unknown> {...props} request={asked} isChatting={false} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    rerender(<RequestCard<unknown> {...props} request={asked} isChatting />);
    expect(region.textContent).toBe('Forma is working on it.');
    // A pause between a turn's steps is not its end.
    rerender(<RequestCard<unknown> {...props} request={asked} isChatting={false} busy />);
    expect(region.textContent).toBe('Forma is working on it.');
    rerender(<RequestCard<unknown> {...props} request={request} isChatting={false} />);
    expect(region.textContent).toBe('Forma replied: Both are changed in place.');
    expect(screen.getByRole('status')).toBe(region);
  });

  // Agent audit item 30: a request the log found by its question marks it there, and hides no reply.
  it('marks a search in what was asked, and still shows the replies', () => {
    draw({ query: 'total' });
    expect(document.querySelector('.wb-ask mark.wb-hit')?.textContent).toBe('total');
    expect(screen.getByText('Both are changed in place.')).toBeTruthy();
    expect(screen.queryByText('No message holds that.')).toBeNull();
  });
});

/*
 * The pill's own controls (2026-11-04, and the pill's alone since 2026-11-06,
 * when the workspace audit removed the thread's copy of them, which the card
 * never reached). Moved here from ChatThread.test.tsx with them. In a row of
 * their own under the words since 2026-11-07 (agent audit item 65): they were
 * behind the arrow, so `open` is gone from these cases.
 */
describe("the pill's edit, withdraw and versions", () => {
  it('offers them without opening the message', () => {
    draw({ onEdit: vi.fn(), onWithdraw: vi.fn() });
    const row = screen.getByRole('group', { name: 'Your message' });
    expect([...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Copy', 'Edit', 'Withdraw']);
    expect(screen.getByRole('button', { name: 'Show the whole message' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('sends nothing for unchanged text, and Escape puts the message back', () => {
    const onEdit = vi.fn();
    draw({ onEdit });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Edit your message'), { key: 'Escape' });
    expect(screen.queryByLabelText('Edit your message')).toBeNull();
  });

  it('offers editing a message sent with pictures, which an edit sends again', () => {
    draw({ onEdit: vi.fn(), onWithdraw: vi.fn(), request: { id: 'q1', ask: { ...ask, images: ['data:image/png;base64,AA'] }, replies: [] } });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('shows which version of a message is showing, and asks for the one before or after', () => {
    const onShowVersion = vi.fn();
    const branches = [{ text: 'make it blue', tail: [] }, { text: 'make it green', tail: [] }, { text: 'make it red', tail: [] }];
    draw({ onShowVersion, request: { id: 'q1', ask: { ...ask, text: 'make it green', branches, branch: 1 }, replies: [] } });
    const versions = screen.getByRole('group', { name: 'Versions of this message' });
    expect(versions.textContent).toBe('2/3');
    fireEvent.click(screen.getByLabelText('Previous version'));
    expect(onShowVersion).toHaveBeenLastCalledWith('q1', 0);
    fireEvent.click(screen.getByLabelText('Next version'));
    expect(onShowVersion).toHaveBeenLastCalledWith('q1', 2);
  });

  it('draws no versions for a message that has only the one', () => {
    draw({ onShowVersion: vi.fn() });
    expect(screen.queryByRole('group', { name: 'Versions of this message' })).toBeNull();
  });

  it('withdraws only once asked twice, and Keep changes nothing', () => {
    const onWithdraw = vi.fn();
    draw({ onWithdraw });
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
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
