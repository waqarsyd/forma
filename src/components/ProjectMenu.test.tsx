// @vitest-environment jsdom
/**
 * The open project's menu from its title (2026-11-06), as Stitch's: Rename
 * in place, Duplicate, Archive, and a Delete that asks once in the menu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ProjectMenu from './ProjectMenu';

afterEach(cleanup);

const handlers = () => ({ onRename: vi.fn(), onDuplicate: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() });

describe('ProjectMenu', () => {
  it('renames in place, and sends nothing when the name did not change', () => {
    const h = handlers();
    render(<ProjectMenu name="Invoice" {...h} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = screen.getByLabelText('Project name') as HTMLInputElement;
    expect(field.value).toBe('Invoice');
    fireEvent.change(field, { target: { value: '  Invoice 2026  ' } });
    fireEvent.submit(field.closest('form')!);
    expect(h.onRename).toHaveBeenCalledWith('Invoice 2026');
    expect(h.onClose).toHaveBeenCalled();
    cleanup();
    const again = handlers();
    render(<ProjectMenu name="Invoice" {...again} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.submit((screen.getByLabelText('Project name') as HTMLInputElement).closest('form')!);
    expect(again.onRename).not.toHaveBeenCalled();
  });

  it('asks once before deleting, and keeps the project when told to', () => {
    const h = handlers();
    render(<ProjectMenu name="Invoice" {...h} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(h.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  // Ctrl+K's "Rename the project…" and "Delete the project…" (2026-11-06).
  it('opens at Rename\'s field or at Delete\'s question when asked to', () => {
    render(<ProjectMenu name="Invoice" {...handlers()} start="rename" />);
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Invoice');
    cleanup();
    const h = handlers();
    render(<ProjectMenu name="Invoice" {...h} start="delete" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  it('duplicates and archives, offers no download (Export has it), and greys what an unsaved project cannot do', () => {
    const h = handlers();
    render(<ProjectMenu name="Invoice" {...h} />);
    expect(screen.queryByRole('menuitem', { name: /Download/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(h.onDuplicate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(h.onArchive).toHaveBeenCalled();
    cleanup();
    render(<ProjectMenu name="Invoice" {...handlers()} archived />);
    expect(screen.getByRole('menuitem', { name: 'Bring back from the archive' })).toBeTruthy();
    cleanup();
    render(<ProjectMenu name="Untitled report" onClose={vi.fn()} />);
    expect((screen.getByRole('menuitem', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Saved projects can be renamed/)).toBeTruthy();
  });
});
