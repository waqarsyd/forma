// @vitest-environment jsdom
/**
 * The conversation as a thread in a panel down the left (2026-11-08), as
 * Google Stitch's workspace draws it since it changed: every request a
 * section, what was asked pinned at its top in a pill, Forma's replies under
 * it, the box at the panel's foot, and a mark that folds the panel away.
 * `requestsOf` in chatSession.test.ts proves the grouping; this proves what
 * the panel draws from it. The pill's cases came from RequestCard.test.tsx,
 * the card of 2026-11-05 that showed one request at a time.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ConversationPanel from './ConversationPanel';
import type { PreviewMeta } from '../lib/attachments';
import type { ChatMessage, ChatRequest } from '../lib/chatSession';

afterEach(cleanup);
// The replies' Markdown renderer is lazy; pay for its import outside a test's budget.
beforeAll(async () => {
  await import('./Markdown');
}, 60_000);

type Msg = ChatMessage<unknown, PreviewMeta>;
type Req = ChatRequest<unknown, PreviewMeta>;
const ask: Msg = { id: 'q1', role: 'user', text: 'Make the total bold\nand right-align the amounts' };
const reply: Msg = { id: 'r1', role: 'assistant', text: 'Both are changed in place.' };
const request: Req = { id: 'q1', ask, replies: [reply] };
const second: Req = {
  id: 'q2',
  ask: { id: 'q2', role: 'user', text: 'Add a page number' },
  replies: [{ id: 'r2', role: 'assistant', text: 'It is in the page footer now.' }],
};

type Props = React.ComponentProps<typeof ConversationPanel<unknown>>;
const base: Props = {
  requests: [request],
  collapsed: false,
  onToggle: () => {},
  isChatting: false,
  isAnalyzing: false,
  streamingReply: '',
  onRetry: () => {},
  onOpenAttachment: () => {},
};
const draw = (props: Partial<Props> = {}) => render(<ConversationPanel<unknown> {...base} {...props} />);

describe('the thread', () => {
  it('draws every request in order, each a section with what was asked pinned at its top', () => {
    draw({ requests: [request, second] });
    const turns = [...document.querySelectorAll('.wb-turn')];
    expect(turns.map((t) => t.getAttribute('data-turn'))).toEqual(['q1', 'q2']);
    expect(turns[0].querySelector('.wb-turn-ask .wb-ask-text')?.textContent).toBe('Make the total bold');
    expect(turns[1].querySelector('.wb-turn-ask .wb-ask-text')?.textContent).toBe('Add a page number');
    expect(turns[1].textContent).toContain('It is in the page footer now.');
    // The ask is the pill's, never a bubble of the thread as well.
    expect(document.querySelector('.wb-note--me')).toBeNull();
  });

  it('shows Forma working in the newest request, under its pinned ask', () => {
    draw({ requests: [request, { ...second, replies: [] }], isChatting: true });
    const turns = document.querySelectorAll('.wb-turn');
    expect(turns[1].querySelector('.wb-working')).toBeTruthy();
    expect(turns[0].querySelector('.wb-working')).toBeNull();
  });

  it('holds the box at its foot, and folds the box away with the conversation', () => {
    const { rerender } = draw({ foot: <textarea aria-label="Message" /> });
    expect(document.querySelector('.wb-panel-foot textarea')).toBeTruthy();
    rerender(<ConversationPanel<unknown> {...base} collapsed foot={<textarea aria-label="Message" />} />);
    expect(document.querySelector('.wb-panel')?.className).toContain('wb-is-collapsed');
    // Hidden, not dropped: what was typed in the box survives a fold.
    expect(document.querySelector('.wb-panel-foot textarea')).toBeTruthy();
  });

  it('offers to show on the Preview what a request changed, and marks the one shown', () => {
    const onShowChange = vi.fn();
    draw({ requests: [request, second], changed: new Set(['q2']), onShowChange, currentId: 'q2' });
    const buttons = screen.getAllByRole('button', { name: 'Show what it changed' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onShowChange).toHaveBeenCalledWith('q2');
    expect(document.querySelector('.wb-turn[aria-current="true"]')?.getAttribute('data-turn')).toBe('q2');
  });
});

describe("the panel's header", () => {
  it('searches the conversation, marking matches in what was asked and in the replies, and Escape closes it', () => {
    const onQuery = vi.fn();
    const { rerender } = draw({ requests: [request, second], onQuery });
    fireEvent.click(screen.getByRole('button', { name: 'Search the conversation' }));
    const field = screen.getByRole('searchbox', { name: 'Search the conversation' });
    fireEvent.change(field, { target: { value: 'page' } });
    expect(onQuery).toHaveBeenLastCalledWith('page');
    rerender(<ConversationPanel<unknown> {...base} requests={[request, second]} onQuery={onQuery} query="page" />);
    expect([...document.querySelectorAll('mark.wb-hit')].map((m) => m.textContent)).toEqual(['page', 'page']);
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search the conversation' }), { key: 'Escape' });
    expect(onQuery).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('opens the search when told to, as the command menu does', () => {
    const { rerender } = draw();
    expect(screen.queryByRole('searchbox')).toBeNull();
    rerender(<ConversationPanel<unknown> {...base} revealSearch={1} />);
    expect(screen.getByRole('searchbox', { name: 'Search the conversation' })).toBeTruthy();
  });

  it('downloads the conversation, and offers neither tool before there is one', () => {
    const onExport = vi.fn();
    const { rerender } = draw({ onExport });
    fireEvent.click(screen.getByRole('button', { name: 'Download the conversation' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    rerender(<ConversationPanel<unknown> {...base} requests={[]} onExport={onExport} />);
    expect(screen.queryByRole('button', { name: 'Download the conversation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search the conversation' })).toBeNull();
  });
});

describe('the pill and the fold', () => {
  it('pins what was asked in a pill, its first line until opened, with the reply under it', () => {
    draw();
    const pill = screen.getByText('Make the total bold');
    expect(pill.className).toContain('wb-ask-text');
    expect(screen.getByText('Both are changed in place.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole message' }));
    expect(screen.getByText(/and right-align the amounts/)).toBeTruthy();
  });

  it('folds to its mark, and the mark opens it again', () => {
    const onToggle = vi.fn();
    draw({ collapsed: true, onToggle });
    expect((document.querySelector('.wb-panel-convo') as HTMLElement).hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show the conversation' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // Agent audit item 98: two dots on a pill read as someone typing.
  it('marks folding with icons, not dots, and shows a quiet dot on the folded panel while Forma works', () => {
    const { rerender } = draw();
    const mark = screen.getByRole('button', { name: 'Fold the conversation away' });
    expect(mark.querySelector('svg')).toBeTruthy();
    expect(mark.querySelectorAll('i')).toHaveLength(0);
    rerender(<ConversationPanel<unknown> {...base} collapsed />);
    expect(document.querySelector('.wb-reply-busy')).toBeNull();
    rerender(<ConversationPanel<unknown> {...base} collapsed isChatting />);
    expect(document.querySelector('.wb-reply-busy')).toBeTruthy();
  });

  // Agent audit item 32: a fold hid the card by dropping it, and with it an edit being typed.
  it('keeps an edit being typed over a fold', () => {
    const onEdit = vi.fn();
    const { rerender } = draw({ onEdit });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Edit your message'), { target: { value: 'Make the total red' } });
    rerender(<ConversationPanel<unknown> {...base} onEdit={onEdit} collapsed />);
    rerender(<ConversationPanel<unknown> {...base} onEdit={onEdit} collapsed={false} />);
    expect((screen.getByLabelText('Edit your message') as HTMLTextAreaElement).value).toBe('Make the total red');
  });

  it('edits what was asked from the pill, and offers Try again when the turn failed', () => {
    const onEdit = vi.fn();
    const onRetry = vi.fn();
    draw({ onEdit, onRetry, requests: [{ id: 'q1', ask: { ...ask, error: 'Google was busy.' }, replies: [] }] });
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
    draw({ onRegenerate: vi.fn(), requests: [{ id: 'r1', ask: null, replies: [{ ...reply, standalone: true }] }] });
    expect(screen.getByText('Both are changed in place.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('refuses a retry while something runs', () => {
    draw({ isAnalyzing: true, requests: [{ id: 'q1', ask: { ...ask, error: 'failed' }, replies: [] }] });
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // Agent audit item 61: the pill showed no time.
  it('says when the message was sent', () => {
    const at = new Date();
    at.setHours(10, 42, 0, 0);
    draw({ requests: [{ id: 'q1', ask: { ...ask, id: `${at.getTime()}-0` }, replies: [reply] }] });
    expect(screen.getByRole('group', { name: 'Your message' }).querySelector('.wb-note-meta')?.textContent).toMatch(/^Today, /);
  });

  // Pages of one upload are one thumbnail, and the viewer gets them all.
  it('shows the pictures sent, a file of pages as one, and opens all its pages', () => {
    const onOpenAttachment = vi.fn();
    const pages = ['data:image/png;base64,A', 'data:image/png;base64,B', 'data:image/png;base64,C'];
    const imageMeta = [1, 2, 3].map((page) => ({ uploadId: 'u1', file: 'invoice.pdf', page }));
    draw({ onOpenAttachment, requests: [{ id: 'q1', ask: { ...ask, images: [...pages, 'data:image/png;base64,D'], imageMeta: [...imageMeta, { uploadId: 'u2', file: 'invoice.pdf' }] }, replies: [] }] });
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole message and its pictures' }));
    const shots = document.querySelectorAll('.wb-attach-shot');
    expect(shots).toHaveLength(2);
    expect(shots[0].getAttribute('aria-label')).toBe('View invoice.pdf · 3 pages');
    fireEvent.click(shots[0]);
    expect(onOpenAttachment).toHaveBeenCalledWith({ srcs: pages, index: 0, file: 'invoice.pdf' });
  });

  // Agent audit item 7: one region, mounted empty and kept, says when Forma starts and what came of it.
  it('announces when Forma starts and what came of the newest request, once it ends', () => {
    const asked: Req = { id: 'q1', ask, replies: [] };
    const { rerender } = render(<ConversationPanel<unknown> {...base} requests={[asked]} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    rerender(<ConversationPanel<unknown> {...base} requests={[asked]} isChatting />);
    expect(region.textContent).toBe('Forma is working on it.');
    // A pause between a turn's steps is not its end.
    rerender(<ConversationPanel<unknown> {...base} requests={[asked]} busy />);
    expect(region.textContent).toBe('Forma is working on it.');
    rerender(<ConversationPanel<unknown> {...base} requests={[request]} />);
    expect(region.textContent).toBe('Forma replied: Both are changed in place.');
    expect(screen.getByRole('status')).toBe(region);
  });
});

/*
 * The pill's own controls (2026-11-04), in a row of their own under the words
 * since 2026-11-07 (agent audit item 65).
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
    draw({ onEdit: vi.fn(), onWithdraw: vi.fn(), requests: [{ id: 'q1', ask: { ...ask, images: ['data:image/png;base64,AA'] }, replies: [] }] });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('shows which version of a message is showing, and asks for the one before or after', () => {
    const onShowVersion = vi.fn();
    const branches = [{ text: 'make it blue', tail: [] }, { text: 'make it green', tail: [] }, { text: 'make it red', tail: [] }];
    draw({ onShowVersion, requests: [{ id: 'q1', ask: { ...ask, text: 'make it green', branches, branch: 1 }, replies: [] }] });
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
