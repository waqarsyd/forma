// @vitest-environment jsdom
/**
 * Every request beneath the card (2026-11-05), as Google Stitch's Agent log:
 * folded to a line with the count, open it lists the requests newest first,
 * each marked for where it stands, and picking one shows it in the card.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import RequestLog from './RequestLog';
import type { ChatRequest } from '../lib/chatSession';

afterEach(cleanup);

const requests: ChatRequest[] = [
  { id: 'a', ask: { id: 'a', role: 'user', text: 'An invoice like this photo' }, replies: [{ id: 'a1', role: 'assistant', text: 'Built.' }] },
  { id: 'b', ask: { id: 'b', role: 'user', text: 'Put the terms under the total' }, replies: [{ id: 'b1', role: 'assistant', text: 'x', error: 'Busy.' }] },
  { id: 'c', ask: { id: 'c', role: 'user', text: 'Make the total bold' }, replies: [] },
];

describe('RequestLog', () => {
  it('folds to one line with the count, and opens into the requests, newest first, each marked', () => {
    render(<RequestLog requests={requests} shownId="c" working onShow={() => {}} />);
    const head = screen.getByRole('button', { name: /Requests/ });
    expect(head.textContent).toContain('3');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(head);
    const items = within(screen.getByRole('list')).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['Make the total bold', 'Put the terms under the total', 'An invoice like this photo']);
    expect(items[0].getAttribute('aria-current')).toBe('true');
    expect(within(items[0]).getByRole('img').getAttribute('aria-label')).toBe('Working');
    expect(within(items[1]).getByRole('img').getAttribute('aria-label')).toBe('Failed');
    expect(within(items[2]).getByRole('img').getAttribute('aria-label')).toBe('Answered');
  });

  // Agent audit item 66: the command menu opens the log.
  it('opens when it is told to, from the command menu', () => {
    const { rerender } = render(<RequestLog requests={requests} shownId="c" working={false} onShow={() => {}} />);
    expect(screen.queryByRole('list')).toBeNull();
    rerender(<RequestLog requests={requests} shownId="c" working={false} onShow={() => {}} reveal={1} />);
    expect(screen.getByRole('list')).toBeTruthy();
  });

  it('shows a picked request, and searches what the requests say', () => {
    const onShow = vi.fn();
    render(<RequestLog requests={requests} shownId="c" working={false} onShow={onShow} onExport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Requests/ }));
    fireEvent.click(screen.getByRole('button', { name: /An invoice/ }));
    expect(onShow).toHaveBeenCalledWith('a');
    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: 'built' } });
    expect(within(screen.getByRole('list')).getAllByRole('button').map((b) => b.textContent)).toEqual(['An invoice like this photo']);
    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: 'chart' } });
    expect(screen.getByText('No request holds that.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export the chat' })).toBeTruthy();
  });

  // The workspace audit, 2026-11-06: the box's Stop is the one Stop, and the
  // search reaches the card, which App marks with what is passed on.
  it('draws no Stop of its own, and passes the search on', () => {
    const onQuery = vi.fn();
    render(<RequestLog requests={requests} shownId="c" working onShow={() => {}} onQuery={onQuery} />);
    fireEvent.click(screen.getByRole('button', { name: /Requests/ }));
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: 'total' } });
    expect(onQuery).toHaveBeenLastCalledWith('total');
  });

  // Agent audit item 29: App holds the search, so the card and the log cannot disagree.
  it('shows the search App holds, and filters by it', () => {
    const onQuery = vi.fn();
    const { rerender } = render(<RequestLog requests={requests} shownId="c" working={false} onShow={() => {}} query="terms" onQuery={onQuery} />);
    fireEvent.click(screen.getByRole('button', { name: /Requests/ }));
    expect((screen.getByLabelText('Search requests') as HTMLInputElement).value).toBe('terms');
    expect(within(screen.getByRole('list')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Put the terms under the total']);
    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: 'bold' } });
    expect(onQuery).toHaveBeenLastCalledWith('bold');
    // Nothing changes until App says so.
    expect((screen.getByLabelText('Search requests') as HTMLInputElement).value).toBe('terms');
    rerender(<RequestLog requests={requests} shownId="c" working={false} onShow={() => {}} query="" onQuery={onQuery} />);
    expect(within(screen.getByRole('list')).getAllByRole('button')).toHaveLength(3);
  });

  // Agent audit items 64 and 76: a title can be read whole from the keyboard, and App knows when the log is open.
  it('names each request whole, and says when it opens and closes', () => {
    const onOpenChange = vi.fn();
    render(<RequestLog requests={requests} shownId="c" working={false} onShow={() => {}} onOpenChange={onOpenChange} />);
    const head = screen.getByRole('button', { name: /Requests/ });
    fireEvent.click(head);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    const item = screen.getByRole('button', { name: /Put the terms/ });
    expect(item.getAttribute('title')).toBe('Put the terms under the total');
    fireEvent.focus(item);
    fireEvent.click(head);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });
});
