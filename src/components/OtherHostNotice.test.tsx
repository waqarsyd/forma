// @vitest-environment jsdom
/**
 * The note on Forma's other addresses (2026-11-12, the owner's decision 9 of
 * the 2026-11-11 audit). Where it shows is `isOtherHost` (lib/seo.test.ts) and
 * main.tsx; this holds what it says, where it points and that a dismissal
 * stays on the device.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import OtherHostNotice, { CLOSED_KEY } from './OtherHostNotice';
import { navigate } from '../lib/router';

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

const link = () => screen.getByRole('link', { name: 'openforma.web.app' }) as HTMLAnchorElement;

describe('the note on another of Forma\'s addresses', () => {
  it('says which address is Forma\'s and why it matters, pointing to the same page there', () => {
    window.history.replaceState({}, '', '/docs');
    render(<OtherHostNotice />);
    const note = screen.getByRole('region', { name: "Forma's main address" });
    expect(note.textContent).toBe("Forma's main address is openforma.web.app. Projects kept in this browser while you're signed out stay on this address; signed-in projects follow your account.Dismiss");
    expect(link().getAttribute('href')).toBe('https://openforma.web.app/docs');
    expect(link().getAttribute('target')).toBeNull();
    // Another page, another link.
    act(() => navigate('/faq'));
    expect(link().getAttribute('href')).toBe('https://openforma.web.app/faq');
  });

  it('opens the workspace\'s page in a new tab, so the work open here is not left', () => {
    window.history.replaceState({}, '', '/workspace');
    render(<OtherHostNotice />);
    expect(link().getAttribute('href')).toBe('https://openforma.web.app/workspace');
    expect(link().getAttribute('target')).toBe('_blank');
    expect(link().getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('stays closed on this device once dismissed', () => {
    render(<OtherHostNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: "Forma's main address" })).toBeNull();
    expect(localStorage.getItem(CLOSED_KEY)).toBe('1');
    cleanup();
    render(<OtherHostNotice />);
    expect(screen.queryByRole('region', { name: "Forma's main address" })).toBeNull();
  });
});
