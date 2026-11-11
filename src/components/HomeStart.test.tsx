// @vitest-environment jsdom
/**
 * The empty workspace as a home (2026-11-06), as Stitch's: the recent
 * projects to open, and the starting points to put in the box.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import HomeStart from './HomeStart';
import { STARTING_POINTS } from '../lib/startingPoints';

afterEach(cleanup);

const recent = [
  { id: 'b', name: 'Quarterly sales', timestamp: '2026-11-05T10:00:00Z' },
  { id: 'a', name: 'Invoice 42', timestamp: '2026-11-04T10:00:00Z' },
];

describe('HomeStart', () => {
  it('opens a recent project, and all of them', () => {
    const onOpen = vi.fn();
    const onAllProjects = vi.fn();
    render(<HomeStart projects={recent} archived={[]} onOpen={onOpen} onAllProjects={onAllProjects} onPick={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Recent projects' });
    fireEvent.click(within(nav).getByRole('button', { name: /Invoice 42/ }));
    expect(onOpen).toHaveBeenCalledWith(recent[1]);
    fireEvent.click(within(nav).getByRole('button', { name: 'All projects' }));
    expect(onAllProjects).toHaveBeenCalled();
  });

  it('hands back the starting point picked, and shows no project list when there is none', () => {
    const onPick = vi.fn();
    render(<HomeStart projects={[]} archived={[]} onOpen={vi.fn()} onAllProjects={vi.fn()} onPick={onPick} />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('heading', { name: 'What report shall we make?' })).toBeTruthy();
    // The box is at the foot of the left panel on a desktop, not below this (the full audit's WS-44).
    expect(screen.getByText(/in the message box, or describe the report you want/)).toBeTruthy();
    expect(screen.queryByText(/box below/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Sales by region/ }));
    expect(onPick).toHaveBeenCalledWith(STARTING_POINTS[2]);
  });
});
