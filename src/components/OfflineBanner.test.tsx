// @vitest-environment jsdom
/**
 * The one offline notice (2026-11-11, the full audit's WS-21 and SA-26): the
 * workspace said it twice, the second time as an error over the message box,
 * and the pill sat over the box at the foot of a phone's screen. One pill
 * now, saying in the workspace that what is typed is kept, and at the top there.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import OfflineBanner, { NoticePill, offlineText } from './OfflineBanner';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function offline() {
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
}

describe('OfflineBanner', () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  });

  it('sits at the top of the workspace, clear of the box, and says what is typed is kept', () => {
    window.history.replaceState({}, '', '/workspace');
    offline();
    render(<OfflineBanner />);
    const pill = screen.getByRole('status');
    expect(pill.className).toContain('top-3');
    expect(pill.className).not.toContain('bottom-4');
    expect(pill.textContent).toBe(offlineText(false, false, true));
    expect(pill.textContent).toMatch(/what you write is kept; send it once you are back/);
    // Kept, not queued: nothing sends it on its own, and a message sent offline is told to be sent again.
    expect(pill.textContent).not.toMatch(/waits to be sent/);
  });

  it('sits at the foot of a public page', () => {
    window.history.replaceState({}, '', '/docs');
    offline();
    render(<OfflineBanner />);
    const pill = screen.getByRole('status');
    expect(pill.className).toContain('bottom-4');
    expect(pill.textContent).toMatch(/^You are offline\./);
  });

  it('says nothing while online', () => {
    render(<OfflineBanner />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  // A wave-4 follow-up (2026-11-11): a sign-up made from the workspace now says it sent a link, as the public site does.
  it("keeps a sign-in's word until it is dismissed, at the top of the workspace", () => {
    const onDismiss = vi.fn();
    render(<NoticePill text="We sent a link to a@example.com." onDismiss={onDismiss} atTop />);
    const pill = screen.getByRole('status');
    expect(pill.className).toContain('top-3');
    expect(pill.textContent).toContain('We sent a link to a@example.com.');
    // No orange ring in the workspace: the public site's u-focus-ring is not used there.
    expect(screen.getByRole('button', { name: 'Dismiss' }).className).not.toContain('u-focus-ring');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/const handleLoginSuccess = useCallback\(\(notice\?: string\) => \{\s*setShowLogin\(false\);\s*setAfterSignIn\(notice \?\? null\);/);
  });

  it('is the only offline notice: the workspace no longer puts one of its own over the box', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).not.toMatch(/addEventListener\('offline'/);
    expect(app).not.toMatch(/You're offline/);
  });
});
