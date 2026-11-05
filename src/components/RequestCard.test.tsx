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
});
