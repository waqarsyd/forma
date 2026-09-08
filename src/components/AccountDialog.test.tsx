// @vitest-environment jsdom
/**
 * The account dialog.
 *
 * Everything here is destructive or hard to undo — a password the owner may
 * not know afterwards, an address the account moves to, and a deletion that
 * takes the saved reports with it. It had no tests, which is how the defects
 * below survived: none of them throws, and all four look fine in a screenshot.
 *
 * Firebase is mocked at the module boundary. This file is about the surface —
 * which control is enabled when, what each one sends, and what it says when it
 * fails. `tests/accountDeletion.test.ts` proves the deletion really removes the
 * data, against the emulator with production rules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import AccountDialog from './AccountDialog';

const changePassword = vi.fn(async () => undefined);
const deleteAccountAndData = vi.fn(async () => undefined);
const requestEmailChange = vi.fn(async () => undefined);
const sendVerificationEmail = vi.fn(async () => undefined);
const setDisplayName = vi.fn(async () => undefined);

vi.mock('../services/firebase', () => ({
  hasPasswordProvider: (user: User) =>
    user.providerData.some((p) => p?.providerId === 'password'),
  changePassword: (...args: unknown[]) => changePassword(...(args as [])),
  deleteAccountAndData: (...args: unknown[]) => deleteAccountAndData(...(args as [])),
  requestEmailChange: (...args: unknown[]) => requestEmailChange(...(args as [])),
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...(args as [])),
  setDisplayName: (...args: unknown[]) => setDisplayName(...(args as [])),
}));

const passwordUser = {
  email: 'owner@example.com',
  displayName: 'Ada',
  emailVerified: true,
  providerData: [{ providerId: 'password' }],
} as unknown as User;

const googleUser = {
  email: 'owner@gmail.com',
  displayName: 'Ada',
  emailVerified: true,
  providerData: [{ providerId: 'google.com' }],
} as unknown as User;

const draw = (user: User = passwordUser, onClose = vi.fn()) =>
  render(<AccountDialog user={user} onClose={onClose} />);

const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  changePassword.mockClear();
  deleteAccountAndData.mockClear();
  requestEmailChange.mockClear();
  sendVerificationEmail.mockClear();
  setDisplayName.mockClear();
});

afterEach(cleanup);

describe('what it says you are signed in as', () => {
  it('names the address and the provider', () => {
    draw();
    expect(screen.getByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText(/email and password account/i)).toBeTruthy();
  });

  it('says Google, and offers no password fields, for a Google account', () => {
    draw(googleUser);
    expect(screen.getByText(/signed in with google/i)).toBeTruthy();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
    expect(screen.queryByLabelText(/new email address/i)).toBeNull();
  });
});

describe('the display name', () => {
  it('will not save what has not changed', () => {
    draw();
    expect(button(/^save$/i).disabled).toBe(true);
  });

  it('saves a changed name', async () => {
    draw();
    fireEvent.change(field(/display name/i), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(button(/^save$/i));
    await waitFor(() => expect(setDisplayName).toHaveBeenCalledWith(passwordUser, 'Ada Lovelace'));
  });

  it('trims before saving, so a stray space is not a new name', async () => {
    draw();
    fireEvent.change(field(/display name/i), { target: { value: '  Ada Lovelace  ' } });
    fireEvent.click(button(/^save$/i));
    await waitFor(() => expect(setDisplayName).toHaveBeenCalledWith(passwordUser, 'Ada Lovelace'));
  });

  /*
   * Clearing the field left Save enabled: `nameTooShort` required at least one
   * character, so an empty box was not "too short". The click then threw a
   * `custom` code that is not in AUTH_MESSAGES, and the user was told "That did
   * not work. Please try again." about a rule nobody had stated.
   */
  it('refuses an empty name instead of failing with a generic error', () => {
    draw();
    fireEvent.change(field(/display name/i), { target: { value: '   ' } });
    expect(button(/^save$/i).disabled).toBe(true);
    expect(screen.getByText(/at least 2 characters/i)).toBeTruthy();
    expect(setDisplayName).not.toHaveBeenCalled();
  });

  it('refuses a one-character name and says why', () => {
    draw();
    fireEvent.change(field(/display name/i), { target: { value: 'A' } });
    expect(button(/^save$/i).disabled).toBe(true);
    expect(screen.getByText(/at least 2 characters/i)).toBeTruthy();
  });

  /*
   * The hint was visible text with no programmatic relationship to the box it
   * belonged to: no `aria-invalid`, no `aria-describedby`. A sighted user saw
   * red text under the field and a greyed-out Save; a screen-reader user got
   * neither the rejection nor the reason, only a button that had silently
   * stopped working. ContactPage's Field and every LoginPage field already
   * pair the two attributes, so this was the one form in the app that did not.
   */
  it('points the name field at its hint, and marks it invalid', () => {
    draw();
    const input = field(/display name/i);
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toBe(null);

    fireEvent.change(input, { target: { value: 'A' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBe('acct-name-error');
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/at least 2 characters/i);
  });
});

describe('changing the password', () => {
  it('needs the current password and a long enough new one', () => {
    draw();
    expect(button(/change password/i).disabled).toBe(true);

    fireEvent.change(field(/^current password$/i), { target: { value: 'old-secret' } });
    fireEvent.change(field(/^new password$/i), { target: { value: 'short' } });
    expect(button(/change password/i).disabled).toBe(true);
  });

  /*
   * Sign-up asks for the new password twice; this did not. A typo here sets a
   * password the owner does not know, and they find out at the next sign-in on
   * a different device — long after they could connect it to this screen.
   */
  it('asks for the new password twice and refuses a mismatch', () => {
    draw();
    fireEvent.change(field(/^current password$/i), { target: { value: 'old-secret' } });
    fireEvent.change(field(/^new password$/i), { target: { value: 'new-secret' } });
    fireEvent.change(field(/confirm new password/i), { target: { value: 'new-secrat' } });

    expect(button(/change password/i).disabled).toBe(true);
    expect(screen.getByText(/do not match/i)).toBeTruthy();
  });

  /** The same association as the display name, for the same reason. */
  it('points the confirm field at its mismatch hint', () => {
    draw();
    const confirm = field(/confirm new password/i);
    expect(confirm.getAttribute('aria-invalid')).toBe('false');

    fireEvent.change(field(/^new password$/i), { target: { value: 'new-secret' } });
    fireEvent.change(confirm, { target: { value: 'new-secrat' } });

    expect(confirm.getAttribute('aria-invalid')).toBe('true');
    const describedBy = confirm.getAttribute('aria-describedby');
    expect(describedBy).toBe('acct-confirm-error');
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/do not match/i);
  });

  it('changes it once both copies agree', async () => {
    draw();
    fireEvent.change(field(/^current password$/i), { target: { value: 'old-secret' } });
    fireEvent.change(field(/^new password$/i), { target: { value: 'new-secret' } });
    fireEvent.change(field(/confirm new password/i), { target: { value: 'new-secret' } });

    expect(button(/change password/i).disabled).toBe(false);
    fireEvent.click(button(/change password/i));
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith(passwordUser, 'old-secret', 'new-secret')
    );
  });
});

/*
 * The three sections shared one `currentPassword` state between them, and only
 * two of them had an input. So the email section required a password typed into
 * a field in the other column with nothing on screen saying so; typing a
 * password to change it also filled the delete confirmation; and satisfying one
 * section silently satisfied the guard on another.
 */
describe('each section asks for its own password', () => {
  it('gives the email change a password field of its own', () => {
    draw();
    fireEvent.change(field(/new email address/i), { target: { value: 'new@example.com' } });
    expect(button(/send confirmation/i).disabled).toBe(true);

    fireEvent.change(field(/password, to confirm the email change/i), { target: { value: 'old-secret' } });
    expect(button(/send confirmation/i).disabled).toBe(false);
  });

  it('sends the email change with the password typed beside it', async () => {
    draw();
    fireEvent.change(field(/new email address/i), { target: { value: 'new@example.com' } });
    fireEvent.change(field(/password, to confirm the email change/i), { target: { value: 'email-pass' } });
    fireEvent.click(button(/send confirmation/i));
    await waitFor(() =>
      expect(requestEmailChange).toHaveBeenCalledWith(passwordUser, 'new@example.com', 'email-pass')
    );
  });

  it('does not let the password-change field arm the delete button', () => {
    draw();
    fireEvent.change(field(/^current password$/i), { target: { value: 'old-secret' } });
    fireEvent.change(field(/type delete to confirm/i), { target: { value: 'DELETE' } });
    expect(button(/delete my account/i).disabled).toBe(true);
  });

  it('deletes with the password typed in the delete section', async () => {
    draw();
    fireEvent.change(field(/password, to confirm deletion/i), { target: { value: 'delete-pass' } });
    fireEvent.change(field(/type delete to confirm/i), { target: { value: 'DELETE' } });
    expect(button(/delete my account/i).disabled).toBe(false);

    fireEvent.click(button(/delete my account/i));
    await waitFor(() => expect(deleteAccountAndData).toHaveBeenCalledWith(passwordUser, 'delete-pass'));
  });
});

describe('deleting the account', () => {
  it('says what goes and what does not', () => {
    draw();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(screen.getByText(/kept only in this browser are not touched/i)).toBeTruthy();
  });

  it('needs the word typed exactly', () => {
    draw();
    fireEvent.change(field(/password, to confirm deletion/i), { target: { value: 'delete-pass' } });
    for (const typed of ['', 'delete', 'DELET', 'DELETE ']) {
      fireEvent.change(field(/type delete to confirm/i), { target: { value: typed } });
      expect(button(/delete my account/i).disabled).toBe(true);
    }
  });

  // A Google account has no password to re-enter; Firebase reopens the popup.
  it('asks a Google account only for the typed confirmation', async () => {
    draw(googleUser);
    expect(screen.queryByLabelText(/password, to confirm deletion/i)).toBeNull();
    fireEvent.change(field(/type delete to confirm/i), { target: { value: 'DELETE' } });
    expect(button(/delete my account/i).disabled).toBe(false);

    fireEvent.click(button(/delete my account/i));
    await waitFor(() => expect(deleteAccountAndData).toHaveBeenCalledWith(googleUser, ''));
  });
});

describe('when something fails', () => {
  // A failure that only reaches a polite status region is one a screen reader
  // may never announce. These are the messages that matter most on this screen.
  it('reports the error as an alert, not a status', async () => {
    changePassword.mockRejectedValueOnce({ code: 'auth/wrong-password' });
    draw();
    fireEvent.change(field(/^current password$/i), { target: { value: 'wrong' } });
    fireEvent.change(field(/^new password$/i), { target: { value: 'new-secret' } });
    fireEvent.change(field(/confirm new password/i), { target: { value: 'new-secret' } });
    fireEvent.click(button(/change password/i));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/that password is not right/i);
  });

  it('reports a success as a status', async () => {
    draw();
    fireEvent.change(field(/display name/i), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(button(/^save$/i));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/name updated/i);
  });
});

describe('the unverified-address notice', () => {
  it('offers to resend for an unverified password account', async () => {
    draw({ ...passwordUser, emailVerified: false } as unknown as User);
    expect(screen.getByText(/not verified yet/i)).toBeTruthy();
    fireEvent.click(button(/send it again/i));
    await waitFor(() => expect(sendVerificationEmail).toHaveBeenCalled());
  });

  it('says nothing for a verified account', () => {
    draw();
    expect(screen.queryByText(/not verified yet/i)).toBeNull();
  });
});
