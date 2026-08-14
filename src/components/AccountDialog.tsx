import { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  changePassword,
  deleteAccountAndData,
  hasPasswordProvider,
  requestEmailChange,
  sendVerificationEmail,
  setDisplayName,
} from '../services/firebase';
import { IconAlert, IconCheck, IconClose, IconShieldCheck, IconTrash, IconWarn } from './landing/icons';

/**
 * Everything an account owner can do to their own account: rename it, change
 * the password, move it to another address, and delete it along with what it
 * holds.
 *
 * It opens from the workspace rail's account menu, which is the only place in
 * the app a signed-in person is actually working. The marketing pages' profile
 * menu keeps Sign out alone — reaching this from there would mean threading a
 * dialog through five pages for a screen nobody visits mid-scroll.
 *
 * Three rules the surface has to keep:
 *
 * 1. **Sensitive actions re-authenticate.** Firebase refuses a password change,
 *    an email change or a deletion without a recent sign-in, so each of those
 *    asks for the current password (or reopens the Google popup) rather than
 *    failing with `auth/requires-recent-login` and a shrug.
 * 2. **Changing the email verifies the new address first.** The account moves
 *    only once the new inbox has been clicked through, so a typo cannot lock
 *    someone out of their own account.
 * 3. **Deletion says what it deletes, and is typed out in full.** It removes
 *    the saved reports and the encrypted key with the account; a button that
 *    quietly discards someone's work on one click is not a confirmation.
 */

type Feedback = { tone: 'ok' | 'error'; text: string } | null;

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That password is not right.',
  'auth/wrong-password': 'That password is not right.',
  'auth/missing-password': 'Enter your current password.',
  'auth/weak-password': 'Use at least 6 characters.',
  'auth/email-already-in-use': 'Another account already uses that address.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/requires-recent-login': 'For safety, sign in again and then retry this.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes before trying again.',
  'auth/popup-blocked': 'Your browser blocked the confirmation window. Allow pop-ups for this site, then try again.',
  'auth/popup-closed-by-user': 'Confirmation was cancelled.',
  'auth/network-request-failed': 'Could not reach the account service. Check your connection and try again.',
  'auth/operation-not-allowed': 'Email and password sign-in is not enabled for this project.',
};

const messageFor = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  return (code && AUTH_MESSAGES[code]) || 'That did not work. Please try again.';
};

const LABEL =
  'font-code-sm text-[10px] font-medium leading-[1.62] tracking-[0.12em] uppercase text-[color:var(--ink-faint)]';
const FIELD =
  'u-transition h-[42px] w-full rounded-[10px] border border-outline-variant bg-surface-container-low px-3.5 font-body-lg text-[14px] leading-[normal] text-on-surface placeholder:text-[color:var(--ink-faint)] focus:border-secondary focus:outline-none focus:ring-4 focus:ring-[color:var(--accent-wash)] disabled:opacity-60';
const PILL =
  'u-transition u-press u-focus-ring inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2 font-body-lg text-[13.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';

export default function AccountDialog({
  user,
  onClose,
  onProfileUpdated,
}: {
  user: User;
  onClose: () => void;
  /**
   * Called after the profile changes on the account.
   *
   * `updateProfile` mutates the `User` object in place and `onAuthStateChanged`
   * does not fire for it, so nothing re-renders and the rail keeps showing the
   * old name until a reload. Measured: renamed to "Renamed Properly", Firebase
   * stored it, and the avatar still read the name from sign-up. The host bumps
   * a counter on this.
   */
  onProfileUpdated?: () => void;
}) {
  const withPassword = hasPasswordProvider(user);

  const [name, setName] = useState(user.displayName ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [verificationSent, setVerificationSent] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Same contract as the config dialog: focus lands inside, Escape closes, and
  // Tab cannot walk out into the workspace behind the scrim.
  useEffect(() => {
    const node = dialogRef.current;
    const returnFocusTo = document.activeElement as HTMLElement | null;
    node?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;

      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocusTo?.focus?.();
    };
  }, []);

  /** One runner for every action, so none of them can forget to clear `busy`. */
  const run = async (id: string, action: () => Promise<void>, done: string) => {
    setBusy(id);
    setFeedback(null);
    try {
      await action();
      setFeedback({ tone: 'ok', text: done });
    } catch (error) {
      console.error(`Account action "${id}" failed:`, error);
      setFeedback({ tone: 'error', text: messageFor(error) });
    } finally {
      setBusy(null);
    }
  };

  const saveName = () =>
    run(
      'name',
      async () => {
        const trimmed = name.trim();
        if (trimmed.length < 2) throw { code: 'custom', message: 'short' };
        await setDisplayName(user, trimmed);
        onProfileUpdated?.();
      },
      'Name updated.',
    );

  const savePassword = () =>
    run(
      'password',
      async () => {
        await changePassword(user, currentPassword, nextPassword);
        setCurrentPassword('');
        setNextPassword('');
      },
      'Password changed.',
    );

  const saveEmail = () =>
    run(
      'email',
      async () => {
        await requestEmailChange(user, newEmail.trim(), currentPassword);
        setNewEmail('');
        setCurrentPassword('');
      },
      'Check the new address — the change takes effect once you confirm it there.',
    );

  const removeAccount = () =>
    run(
      'delete',
      async () => {
        await deleteAccountAndData(user, currentPassword);
        // Firebase signs the user out as the account goes; the app's auth
        // listener does the rest.
        closeRef.current();
      },
      'Account deleted.',
    );

  const resend = () =>
    run(
      'verify',
      async () => {
        await sendVerificationEmail(user);
        setVerificationSent(true);
      },
      'Verification email sent.',
    );

  const nameTooShort = name.trim().length > 0 && name.trim().length < 2;

  return (
    <div
      className="wb-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="wb-modal wb-reg-marks"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="wb-modal-head">
          <h2 id="account-title">Your account</h2>
          <button className="wb-pill wb-pill--round" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>

        <div className="wb-modal-body">
          <div className="wb-modal-col">
            <div className="wb-fset">
              <div className="wb-eyebrow">
                <b>who</b>Signed in as<span className="wb-fade" />
              </div>

              <div className="wb-note-line">
                <span className="wb-ic"><IconShieldCheck size={13} /></span>
                <span>
                  <b>{user.email}</b>
                  <br />
                  {withPassword ? 'Email and password account.' : 'Signed in with Google.'}
                </span>
              </div>

              {/* Only password accounts can be unverified: Google has already
                  proved the address by the time the popup closes. */}
              {withPassword && !user.emailVerified && (
                <div className="wb-note-line wb-warn">
                  <span className="wb-ic"><IconWarn size={13} /></span>
                  <span>
                    <b>This address is not verified yet.</b> Check your inbox for the link we sent when the account
                    was created.{' '}
                    <button
                      type="button"
                      onClick={resend}
                      disabled={busy !== null || verificationSent}
                      className="u-focus-ring cursor-pointer font-semibold text-secondary underline disabled:no-underline disabled:opacity-60"
                    >
                      {verificationSent ? 'Sent' : busy === 'verify' ? 'Sending…' : 'Send it again'}
                    </button>
                  </span>
                </div>
              )}

              <div>
                <label className={LABEL} htmlFor="acct-name">Display name</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="acct-name"
                    className={FIELD}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                  <button
                    type="button"
                    onClick={saveName}
                    disabled={busy !== null || nameTooShort || name.trim() === (user.displayName ?? '')}
                    className={`${PILL} shrink-0 border border-outline-variant text-on-surface hover:border-secondary hover:text-secondary`}
                  >
                    {busy === 'name' ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {nameTooShort && (
                  <p className="mt-1.5 font-body-lg text-[12.5px] leading-[1.5] text-error">
                    Use at least 2 characters.
                  </p>
                )}
              </div>
            </div>

            {withPassword && (
              <div className="wb-fset">
                <div className="wb-eyebrow">
                  <b>keys</b>Password<span className="wb-fade" />
                </div>
                <div>
                  <label className={LABEL} htmlFor="acct-current">Current password</label>
                  <input
                    id="acct-current"
                    type="password"
                    className={`${FIELD} mt-1.5`}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="acct-next">New password</label>
                  <input
                    id="acct-next"
                    type="password"
                    className={`${FIELD} mt-1.5`}
                    value={nextPassword}
                    onChange={(e) => setNextPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={savePassword}
                    disabled={busy !== null || !currentPassword || nextPassword.length < 6}
                    className={`${PILL} border border-outline-variant text-on-surface hover:border-secondary hover:text-secondary`}
                  >
                    {busy === 'password' ? 'Changing…' : 'Change password'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="wb-modal-col">
            {withPassword && (
              <div className="wb-fset">
                <div className="wb-eyebrow">
                  <b>move</b>Email address<span className="wb-fade" />
                </div>
                <div>
                  <label className={LABEL} htmlFor="acct-email">New email address</label>
                  <input
                    id="acct-email"
                    type="email"
                    className={`${FIELD} mt-1.5`}
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="name@company.com"
                    autoComplete="email"
                  />
                </div>
                <div className="wb-note-line">
                  <span className="wb-ic"><IconCheck size={13} /></span>
                  <span>
                    We send a link to the new address first. The account moves only when you open it, so a typo
                    cannot lock you out. Your current password confirms the change.
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={saveEmail}
                    disabled={busy !== null || !newEmail.trim() || !currentPassword}
                    className={`${PILL} border border-outline-variant text-on-surface hover:border-secondary hover:text-secondary`}
                  >
                    {busy === 'email' ? 'Sending…' : 'Send confirmation'}
                  </button>
                </div>
              </div>
            )}

            <div className="wb-fset">
              <div className="wb-eyebrow">
                <b>end</b>Delete account<span className="wb-fade" />
              </div>

              <div className="wb-note-line wb-warn">
                <span className="wb-ic"><IconAlert size={13} /></span>
                <span>
                  <b>This cannot be undone.</b> Your saved projects and the encrypted copy of your API key are
                  deleted with the account. Reports kept only in this browser are not touched.
                </span>
              </div>

              {withPassword && (
                <div>
                  <label className={LABEL} htmlFor="acct-confirm-pass">Current password</label>
                  <input
                    id="acct-confirm-pass"
                    type="password"
                    className={`${FIELD} mt-1.5`}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
              )}

              <div>
                <label className={LABEL} htmlFor="acct-confirm">
                  Type DELETE to confirm
                </label>
                <input
                  id="acct-confirm"
                  className={`${FIELD} mt-1.5`}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoCapitalize="characters"
                  autoComplete="off"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={removeAccount}
                  disabled={busy !== null || confirmText !== 'DELETE' || (withPassword && !currentPassword)}
                  className={`${PILL} border border-error/50 bg-error/[0.07] text-error hover:bg-error/[0.12]`}
                >
                  <IconTrash size={14} />
                  {busy === 'delete' ? 'Deleting…' : 'Delete my account'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="wb-modal-foot">
          {feedback && (
            <span
              className={`mr-auto font-body-lg text-[13px] leading-[1.5] ${
                feedback.tone === 'ok' ? 'text-on-surface-variant' : 'text-error'
              }`}
              role="status"
            >
              {feedback.text}
            </span>
          )}
          <button className="wb-pill wb-pill--outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
