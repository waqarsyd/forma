// @vitest-environment jsdom
/**
 * The command menu (2026-11-05), Stitch's Ctrl+K, and the shortcuts dialog
 * beside it: a list narrowed by every word typed and run by the keyboard,
 * and every shortcut written for a Mac or a PC.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import CommandMenu, { matchCommands, type Command } from './CommandMenu';
import ShortcutsDialog from './ShortcutsDialog';

afterEach(cleanup);

const commands = (run = vi.fn()): Command[] => [
  { id: 'new', label: 'New report', keys: 'Ctrl+Shift+O', run },
  { id: 'preview', label: 'Show the Preview', run },
  { id: 'go', label: 'Go to labelTitle', run },
];

describe('CommandMenu', () => {
  it('narrows the list by every word typed', () => {
    expect(matchCommands(commands(), 'go title').map((c) => c.id)).toEqual(['go']);
    expect(matchCommands(commands(), '').length).toBe(3);
  });

  it('runs the highlighted command on Enter, after the arrows move, and closes', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const list = commands();
    list[1].run = run;
    render(<CommandMenu commands={list} onClose={onClose} />);
    const input = screen.getByLabelText('Type a command');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  // WS-31 (2026-11-11): two commands that share an id each draw and each run their own.
  it('draws and runs each command, even two that share an id', () => {
    const projects = vi.fn();
    const convo = vi.fn();
    render(<CommandMenu commands={[{ id: 'search', label: 'Search projects', run: projects }, { id: 'search', label: 'Search the conversation', run: convo }]} onClose={vi.fn()} />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Search projects', 'Search the conversation']);
    fireEvent.click(screen.getByText('Search the conversation'));
    expect(convo).toHaveBeenCalledTimes(1);
    expect(projects).not.toHaveBeenCalled();
  });

  it('says when nothing holds the words, and closes on Escape', () => {
    const onClose = vi.fn();
    render(<CommandMenu commands={commands()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Type a command'), { target: { value: 'chart' } });
    expect(screen.getByText('No command holds that.')).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('Type a command'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ShortcutsDialog', () => {
  it('lists the shortcuts by group, with Cmd on a Mac and Ctrl on a PC', () => {
    render(<ShortcutsDialog mac onClose={() => {}} />);
    const general = screen.getByRole('region', { name: 'General' });
    expect(within(general).getByText('Command menu').parentElement?.textContent).toContain('⌘K');
    cleanup();
    render(<ShortcutsDialog mac={false} onClose={() => {}} />);
    expect(within(screen.getByRole('region', { name: 'View' })).getByText('Zoom to fit').parentElement?.textContent).toContain('⇧1');
    expect(within(screen.getByRole('region', { name: 'General' })).getByText('Command menu').parentElement?.textContent).toContain('CtrlK');
  });
});
