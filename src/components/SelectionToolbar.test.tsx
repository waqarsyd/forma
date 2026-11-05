// @vitest-environment jsdom
/**
 * The toolbar over a selection on Preview (2026-11-05), as Stitch shows one
 * over a selected screen: Format, Edit text for one control, and More.
 * `formatEdits` in agentEdit.test.ts proves the edits; this proves the menu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SelectionToolbar from './SelectionToolbar';

afterEach(cleanup);

describe('SelectionToolbar', () => {
  it('names the selection and formats it from its menu', () => {
    const onFormat = vi.fn();
    render(<SelectionToolbar names={['labelTitle']} onFormat={onFormat} onEditText={() => {}} onDelete={() => {}} onClear={() => {}} />);
    expect(screen.getByRole('toolbar', { name: 'The selected controls' }).textContent).toContain('labelTitle');
    fireEvent.click(screen.getByRole('button', { name: /Format/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bold' }));
    expect(onFormat).toHaveBeenCalledWith('bold');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers Edit text for one control only, and Delete and Clear under More', () => {
    const onDelete = vi.fn();
    const onClear = vi.fn();
    render(<SelectionToolbar names={['a', 'b']} onFormat={() => {}} onDelete={onDelete} onClear={onClear} />);
    expect(screen.getByRole('toolbar').textContent).toContain('2 controls');
    expect(screen.queryByRole('button', { name: /Edit text/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear the selection' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
