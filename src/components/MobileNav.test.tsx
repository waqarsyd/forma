// @vitest-environment jsdom
/**
 * The phone menu is a modal dialog (2026-11-08, site audit item 41): it
 * covered the page while focus stayed behind it and nothing called it a
 * dialog.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import MobileNav from './MobileNav';

describe('MobileNav', () => {
  afterEach(cleanup);

  it('opens as a modal dialog with focus inside, and Escape gives focus back to its button', async () => {
    render(<MobileNav active="Docs" />);
    const opener = screen.getByRole('button', { name: 'Open menu' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('aria-current')).toBe('page');

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    // Once the sheet's exit animation has unmounted it.
    await waitFor(() => expect(document.activeElement).toBe(opener), { timeout: 3000 });
  });

  it('says Sign in and Sign up in sentence case, and links the repository', () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe('https://github.com/waqarsyd/forma');
  });
});
