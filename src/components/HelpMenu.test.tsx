// @vitest-environment jsdom
/**
 * The corner's "?" (2026-11-06), as Stitch's: the theme as Light, System or
 * Dark, What's new from the landing page's notes, the shortcuts, help and
 * feedback in a new tab, and the line every AI product owes its reader.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import HelpMenu from './HelpMenu';
import { ANNOUNCEMENTS } from '../lib/announcements';

afterEach(cleanup);

describe('HelpMenu', () => {
  it('marks the theme in force and hands back the one chosen', () => {
    const onTheme = vi.fn();
    render(<HelpMenu theme="system" onTheme={onTheme} onShortcuts={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onTheme).toHaveBeenCalledWith('dark');
  });

  it('opens What\'s new on the newest note, and the shortcuts closing the menu', () => {
    const onShortcuts = vi.fn();
    const onClose = vi.fn();
    render(<HelpMenu theme="light" onTheme={vi.fn()} onShortcuts={onShortcuts} onClose={onClose} />);
    expect(screen.queryByText(ANNOUNCEMENTS[0].title)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /What's new/ }));
    expect(screen.getByText(ANNOUNCEMENTS[0].title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Keyboard shortcuts/ }));
    expect(onShortcuts).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('opens help and feedback in a new tab, says Forma can make mistakes, and closes on Escape', () => {
    const onClose = vi.fn();
    render(<HelpMenu theme="light" onTheme={vi.fn()} onShortcuts={vi.fn()} onClose={onClose} />);
    expect(screen.getByRole('link', { name: /Help/ }).getAttribute('href')).toBe('/docs');
    expect(screen.getByRole('link', { name: /Send feedback/ }).getAttribute('target')).toBe('_blank');
    expect(screen.getByText(/Forma can make mistakes/)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
