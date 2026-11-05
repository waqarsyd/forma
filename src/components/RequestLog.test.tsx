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
});
