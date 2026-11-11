// @vitest-environment jsdom
/**
 * The sign-in card (2026-11-11, the full audit's batch PSB): what it says an
 * account is for (PS-17), what the page is told after an email sign-up, its
 * two modes as plain toggle buttons and its focus trap held to its own
 * element (PS-28), its errors in the visitor's terms, its skip link (PS-31)
 * and fields a phone does not zoom into (PR-09b). Firebase is a stand-in at
 * the module boundary; nothing here signs anyone in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const signInWithEmail = vi.fn(async () => undefined);
const signUpWithEmail = vi.fn(async () => undefined);
vi.mock('../services/firebase', () => ({
  signInWithEmail: (...args: unknown[]) => signInWithEmail(...(args as [])),
  signUpWithEmail: (...args: unknown[]) => signUpWithEmail(...(args as [])),
  signInWithGoogle: vi.fn(async () => undefined),
  sendPasswordReset: vi.fn(async () => undefined),
}));

import LoginPage, { AUTH_MESSAGES, fieldClass, signedUpNotice } from './LoginPage';

beforeEach(() => {
  signInWithEmail.mockReset();
  signUpWithEmail.mockReset();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const card = (mode: 'signin' | 'signup' = 'signin', onSuccess = vi.fn()) => {
  render(<LoginPage initialMode={mode} onClose={vi.fn()} onSuccess={onSuccess} />);
  return onSuccess;
};

describe('LoginPage', () => {
  it('says the three things an account adds', () => {
    card();
    expect(
      screen.getByText(/An account adds three things: your projects follow you to other machines, you can share a report by link, and you can keep an encrypted copy of your API key\./),
    ).toBeTruthy();
    expect(screen.queryByText(/only adds syncing/)).toBeNull();
  });

  it('hands the page the verification notice after an email sign-up, and nothing after a sign-in', async () => {
    const onSuccess = card('signup');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' ada@example.com ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct horse' } });
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith('Account made. We sent a link to ada@example.com: open it to verify the address, which sharing needs.');
    expect(signedUpNotice('x@y.z')).toMatch(/^Account made\. We sent a link to x@y\.z: open it to verify the address, which sharing needs\.$/);

    cleanup();
    const signedIn = card('signin');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever1' } });
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    await waitFor(() => expect(signedIn).toHaveBeenCalledTimes(1));
    expect(signedIn).toHaveBeenCalledWith();
  });

  it('switches mode with two toggle buttons, not tabs without panels', () => {
    card();
    const group = screen.getByRole('group', { name: 'Sign in or create an account' });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    const [signIn, create] = Array.from(group.querySelectorAll('button'));
    expect(signIn.getAttribute('aria-pressed')).toBe('true');
    expect(create.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(create);
    expect(create.getAttribute('aria-pressed')).toBe('true');
    expect(signIn.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps Tab inside its own card when another dialog comes first in the page', () => {
    // jsdom lays nothing out, so offsetParent is null everywhere; the trap
    // skips hidden controls by it, so give every element a parent here.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode; } });
    try {
      const decoy = document.createElement('div');
      decoy.setAttribute('role', 'dialog');
      decoy.innerHTML = '<button type="button">Elsewhere</button>';
      document.body.appendChild(decoy);
      card();
      const dialog = screen.getByRole('dialog', { name: 'Sign in' });
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
      focusable[focusable.length - 1].focus();
      fireEvent.keyDown(window, { key: 'Tab' });
      expect(document.activeElement).toBe(focusable[0]);
      expect(dialog.contains(document.activeElement)).toBe(true);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
    }
  });

  it('opens with a skip link to the card, whose target is not the page behind', () => {
    card();
    const dialog = screen.getByRole('dialog', { name: 'Sign in' });
    const first = dialog.querySelector('a, button')!;
    expect(first.textContent).toBe('Skip to content');
    expect(first.getAttribute('href')).toBe('#sign-in-card');
    const target = document.getElementById('sign-in-card')!;
    expect(dialog.contains(target)).toBe(true);
    expect(target.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('heading', { name: 'Sign in to Forma' }).closest('#sign-in-card')).toBe(target);
  });

  it('says a refusal in the visitor’s terms, with somewhere to go', () => {
    expect(AUTH_MESSAGES['auth/user-disabled']).toBe('This account has been suspended. Write through the contact page.');
    expect(AUTH_MESSAGES['auth/unauthorized-domain']).toBe("Sign-in isn't available on this address. Use https://openforma.web.app.");
    for (const code of ['auth/configuration-not-found', 'auth/operation-not-allowed']) {
      expect(AUTH_MESSAGES[code]).toBe("Email sign-in isn't available right now. Try Google, or write to us from the contact page.");
    }
    for (const said of Object.values(AUTH_MESSAGES)) expect(said).not.toMatch(/Firebase|support|this project|authorized-domain/i);
  });

  it('sets its fields at 16px below the desktop width, so a phone does not zoom into them', () => {
    expect(fieldClass(false)).toContain('max-lg:text-[16px]');
    expect(fieldClass(true)).toContain('max-lg:text-[16px]');
    card();
    expect(screen.getByLabelText('Email address').className).toContain('max-lg:text-[16px]');
  });
});
