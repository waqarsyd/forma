// @vitest-environment jsdom
/**
 * The Projects panel (2026-11-11, out of App.tsx with the full audit's WSX1
 * batch): a row opens from the keyboard (WS-14), the open project's row does
 * nothing (WS-15), a project being opened says so (WS-16), the panel says its
 * own errors (WS-12), and the trash deletes with no question, App's toast
 * holding the Undo (WS-03).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ProjectsPanel, { type ProjectRow } from './ProjectsPanel';

afterEach(cleanup);

const row = (id: string, name: string): ProjectRow => ({ id, name, timestamp: '2026-11-11T09:30:00.000Z', messages: [{ text: `about ${name}` }] });
const ROWS = [row('a', 'Invoice'), row('b', 'Packing slip')];

const panel = (over: Partial<React.ComponentProps<typeof ProjectsPanel>> = {}) => {
  const props = {
    projects: ROWS,
    openId: null as string | null,
    query: null as string | null,
    onQuery: vi.fn(),
    pinned: [] as string[],
    archived: [] as string[],
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onTogglePin: vi.fn(),
    onToggleArchive: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  render(<ProjectsPanel {...props} />);
  return props;
};

const nameButton = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('a row', () => {
  it('opens from its name, a button the keyboard reaches', () => {
    const props = panel();
    const button = nameButton('Invoice');
    expect(button.getAttribute('type')).toBe('button');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(props.onOpen).toHaveBeenCalledWith('a');
  });

  it('marks the open project, and leaves reopening it to App', () => {
    // App answers the open project's row by going back to the conversation,
    // reloading nothing (handleLoadReport's `already`).
    const props = panel({ openId: 'a' });
    expect(nameButton('Invoice').getAttribute('aria-current')).toBe('true');
    expect(nameButton('Packing slip').getAttribute('aria-current')).toBeNull();
    fireEvent.click(nameButton('Invoice'));
    expect(props.onOpen).toHaveBeenCalledWith('a');
    fireEvent.click(nameButton('Packing slip'));
    expect(props.onOpen).toHaveBeenLastCalledWith('b');
  });

  it('says it is opening while its content comes', () => {
    panel({ openingId: 'b' });
    expect(nameButton('Packing slip').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText(/Opening…/)).toBeTruthy();
  });

  it('deletes from the trash at once, asking nothing', () => {
    const props = panel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Invoice' }));
    expect(props.onDelete).toHaveBeenCalledWith(['a']);
  });

  it("keeps a rename's Escape for the rename", () => {
    const props = panel();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Invoice' }));
    const field = screen.getByRole('textbox', { name: 'Rename Invoice' });
    // fireEvent answers false when the event's default was prevented.
    expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Rename Invoice' })).toBeNull();
    expect(props.onRename).not.toHaveBeenCalled();
  });
});

describe('Clear all', () => {
  it('asks once, then deletes every project listed', () => {
    const props = panel();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onDelete).toHaveBeenCalledWith(['a', 'b']);
  });
});

describe('the panel’s own errors', () => {
  it('says a failed list instead of an empty one', () => {
    const onDismissError = vi.fn();
    panel({ projects: [], error: 'Your saved projects could not be loaded just now.', onDismissError });
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/);
    expect(screen.queryByText('No saved projects yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it('says an empty list is empty when nothing failed', () => {
    panel({ projects: [] });
    expect(screen.getByText('No saved projects yet.')).toBeTruthy();
  });
});

describe('the search', () => {
  it('clears its words on Escape and keeps the panel, and with none lets Escape close it', () => {
    const props = panel({ query: 'inv' });
    const typed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    screen.getByRole('searchbox', { name: 'Search projects' }).dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(true);
    expect(props.onQuery).toHaveBeenCalledWith(null);
    cleanup();
    const empty = panel({ query: '' });
    const bare = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    screen.getByRole('searchbox', { name: 'Search projects' }).dispatchEvent(bare);
    expect(bare.defaultPrevented).toBe(false);
    expect(empty.onQuery).toHaveBeenCalledWith(null);
  });
});
