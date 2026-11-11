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

  // WS-16 (BW2, 2026-11-11): the project being opened says so on its own row, not above the whole home.
  it('says "Opening…" on the row of the project being opened, and once when the list does not show it', () => {
    render(<HomeStart projects={recent} archived={[]} onOpen={vi.fn()} onAllProjects={vi.fn()} onPick={vi.fn()} openingId="a" />);
    const nav = screen.getByRole('navigation', { name: 'Recent projects' });
    const row = within(nav).getByRole('button', { name: /Invoice 42/ });
    expect(row.getAttribute('aria-busy')).toBe('true');
    expect(row.textContent).toMatch(/Opening…/);
    expect(row.querySelector('.wb-spin')).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /Quarterly sales/ }).getAttribute('aria-busy')).toBeNull();
    expect(screen.getAllByText(/Opening…/)).toHaveLength(1);
    cleanup();
    render(<HomeStart projects={recent} archived={[]} onOpen={vi.fn()} onAllProjects={vi.fn()} onPick={vi.fn()} openingId="elsewhere" />);
    expect(screen.getByRole('status').textContent).toBe('Opening…');
    cleanup();
    // The Projects panel, open beside it, shows it on its own row.
    render(<HomeStart projects={recent} archived={[]} onOpen={vi.fn()} onAllProjects={vi.fn()} onPick={vi.fn()} openingId="a" showRecent={false} />);
    expect(screen.queryByText(/Opening…/)).toBeNull();
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

  // The full audit's SA-05 (2026-11-11): with no key the box is locked, so the home says so first.
  it('says first that a free key is needed, with the way to add it, and still hands back a starting point', () => {
    const onAddKey = vi.fn();
    const onPick = vi.fn();
    render(<HomeStart projects={[]} archived={[]} onOpen={vi.fn()} onAllProjects={vi.fn()} onPick={onPick} needsKey onAddKey={onAddKey} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Add a free Gemini key to start');
    expect(screen.queryByRole('heading', { name: 'What report shall we make?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add your free key' }));
    expect(onAddKey).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Sales by region/ }));
    expect(onPick).toHaveBeenCalledWith(STARTING_POINTS[2]);
  });
});
