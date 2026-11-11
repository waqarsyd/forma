// @vitest-environment jsdom
/**
 * The corner's "?" (2026-11-06), as Stitch's: the theme as Light, System or
 * Dark, What's new from the landing page's notes, the shortcuts, help and
 * feedback in a new tab, and the line every AI product owes its reader.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import HelpMenu from './HelpMenu';

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

  /* One What's new, the changelog, and the command menu beside the shortcuts
     (2026-11-08): What's new and the changelog were two rows for the same
     news, and the command menu's row was the main menu's. */
  it("opens What's new as the changelog, once, and the command menu and the shortcuts, each closing the menu", () => {
    const onShortcuts = vi.fn();
    const onCommandMenu = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(<HelpMenu theme="light" onTheme={vi.fn()} onShortcuts={vi.fn()} onCommandMenu={onCommandMenu} commandKeys="Ctrl+K" onClose={onClose} />);
    expect(screen.getAllByRole('link', { name: /What's new|Changelog/ }).map((a) => a.getAttribute('href'))).toEqual(['/changelog']);
    fireEvent.click(screen.getByRole('button', { name: /^Command menu/ }));
    expect(onCommandMenu).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    unmount();
    render(<HelpMenu theme="light" onTheme={vi.fn()} onShortcuts={onShortcuts} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Keyboard shortcuts/ }));
    expect(onShortcuts).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('opens help and feedback in a new tab, says Forma can make mistakes, and closes on Escape', () => {
    const onClose = vi.fn();
    render(<HelpMenu theme="light" onTheme={vi.fn()} onShortcuts={vi.fn()} onClose={onClose} />);
    // Docs, the FAQ, Discussions and the privacy notice, as Stitch's "?" lists them (2026-11-08).
    expect(screen.getByRole('link', { name: /^Docs/ }).getAttribute('href')).toBe('/docs');
    expect(screen.getByRole('link', { name: /^FAQ/ }).getAttribute('href')).toBe('/faq');
    expect(screen.getByRole('link', { name: /^Discussions/ }).getAttribute('href')).toBe('https://github.com/waqarsyd/forma/discussions');
    expect(screen.getByRole('link', { name: /^Privacy/ }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: /Send feedback/ }).getAttribute('target')).toBe('_blank');
    expect(screen.getByText(/Forma can make mistakes/)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  /* Help that reaches a person (2026-11-11, the full audit's SA-15b and SA-28b). */
  it('reports a problem through the prefilled GitHub form, with the contact page for people without GitHub', () => {
    render(<HelpMenu theme="light" onTheme={vi.fn()} onShortcuts={vi.fn()} onClose={vi.fn()} />);
    const report = screen.getByRole('link', { name: /^Report a problem/ });
    const url = new URL(report.getAttribute('href')!);
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/waqarsyd/forma/issues/new');
    expect(url.searchParams.get('template')).toBe('bug-report.yml');
    expect(url.searchParams.get('version')).toBeTruthy();
    expect(report.getAttribute('target')).toBe('_blank');
    expect(report.getAttribute('title')).toMatch(/Without a GitHub account, use Send feedback/);
    expect(screen.getByRole('link', { name: /^Send feedback/ }).getAttribute('href')).toBe('/contact');
  });

  it("links Forma's own live checks and Google's status pages", () => {
    render(<HelpMenu theme="light" onTheme={vi.fn()} onShortcuts={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: /^Service status/ }).getAttribute('href')).toBe('https://github.com/waqarsyd/forma/actions/workflows/live.yml');
    expect(screen.getByRole('link', { name: /^Gemini status/ }).getAttribute('href')).toBe('https://aistudio.google.com/status');
    expect(screen.getByRole('link', { name: /^Sign-in and saving status/ }).getAttribute('href')).toBe('https://status.firebase.google.com/');
    for (const name of [/^Service status/, /^Gemini status/, /^Sign-in and saving status/]) {
      expect(screen.getByRole('link', { name }).getAttribute('target')).toBe('_blank');
    }
  });
});
