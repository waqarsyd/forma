import { useRef, useState } from 'react';
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
import { useFocusTrap } from './useFocusTrap';

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
 * 4. **Each section asks for its own password, in its own section.** One shared
 *    `currentPassword` behind all three was wrong in three separate ways — see
 *    the state declarations — and the one that mattered was that filling the
 *    field in one section armed the guard on another. A password box belongs
 *    beside the button it unlocks.
 *
 * `AccountDialog.test.tsx` covers the surface: which control is enabled when,
 * what each one sends, and what it says when it fails. What the deletion
 * actually removes is proved in `tests/accountDeletion.test.ts`, against the
 * emulator with production rules — the two are deliberately separate, because
 * a mocked Firebase can prove neither.
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
  // Ours, not Firebase's. The Save button is disabled for this, so it should be
  // unreachable — but an unmapped code renders as "That did not work. Please
  // try again.", which is how the empty-name case used to report itself.
  'forma/name-too-short': 'Use at least 2 characters.',
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

  /*
   * A password per section, not one shared between them.
   *
   * There was a single `currentPassword` behind all three, with inputs in only
   * two of them, and every consequence of that was wrong. The email change
   * required a password typed into a field in the *other column*, with nothing
   * on screen saying so — its button simply stayed disabled. Typing a password
   * to change it also filled the delete confirmation, because both inputs were
   * the same state. And satisfying one section silently satisfied half the
   * guard on another, on the screen where that matters most.
   */
  const [passwordForChange, setPasswordForChange] = useState('');
  const [passwordForEmail, setPasswordForEmail] = useState('');
  const [passwordForDelete, setPasswordForDelete] = useState('');

  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [verificationSent, setVerificationSent] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Not for the focus trap — that holds its own ref now. This one guards the
   * one place `onClose` is called from inside an `await`: deleting the account
   * re-renders this component while the request is in flight, and the ref makes
   * sure the callback that runs afterwards is the current one rather than the
   * one captured when the button was clicked.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Same contract as the config dialog, and now literally the same code — see
  // useFocusTrap. This dialog unmounts when it closes, so the trap is always
  // armed while it exists and needs no `active` argument.
  useFocusTrap(dialogRef, onClose);

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
        if (trimmed.length < 2) throw { code: 'forma/name-too-short' };
        await setDisplayName(user, trimmed);
        onProfileUpdated?.();
      },
      'Name updated.',
    );

  const savePassword = () =>
    run(
      'password',
      async () => {
        await changePassword(user, passwordForChange, nextPassword);
        setPasswordForChange('');
        setNextPassword('');
        setConfirmPassword('');
      },
      'Password changed.',
    );

  const saveEmail = () =>
    run(
      'email',
      async () => {
        await requestEmailChange(user, newEmail.trim(), passwordForEmail);
        setNewEmail('');
        setPasswordForEmail('');
      },
      'Check the new address — the change takes effect once you confirm it there.',
    );

  const removeAccount = () =>
    run(
      'delete',
      async () => {
        await deleteAccountAndData(user, passwordForDelete);
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

  /*
   * An empty box is too short too.
   *
   * This required at least one character, so clearing the field left Save
   * enabled and the click failed with a generic "That did not work" about a
   * rule that had never been stated. The hint now appears for anything under
   * two characters, blank included, and the button is disabled to match.
   */
  const nameTooShort = name.trim().length < 2;
  const nameUnchanged = name.trim() === (user.displayName ?? '');

  /** Both copies of the new password must agree before it can be set. */
  const passwordsDiffer = confirmPassword.length > 0 && nextPassword !== confirmPassword;
  const canChangePassword =
    passwordForChange.length > 0 && nextPassword.length >= 6 && nextPassword === confirmPassword;

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
                    disabled={busy !== null || nameTooShort || nameUnchanged}
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
                    value={passwordForChange}
                    onChange={(e) => setPasswordForChange(e.target.value)}
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
                {/* Typed twice, as sign-up asks for it. Without this a typo
                    sets a password the owner does not know, and they find out
                    at the next sign-in on another device — long after they
                    could connect it to this screen. */}
                <div>
                  <label className={LABEL} htmlFor="acct-next-confirm">Confirm new password</label>
                  <input
                    id="acct-next-confirm"
                    type="password"
                    className={`${FIELD} mt-1.5`}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Type it again"
                    autoComplete="new-password"
                  />
                  {passwordsDiffer && (
                    <p className="mt-1.5 font-body-lg text-[12.5px] leading-[1.5] text-error">
                      Those two do not match.
                    </p>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={savePassword}
                    disabled={busy !== null || !canChangePassword}
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
                {/* Its own field. This section required a password and had no
                    input, so the one it read lived in the Password fieldset in
                    the other column — the button stayed disabled and nothing on
                    screen said which box would enable it. */}
                <div>
                  <label className={LABEL} htmlFor="acct-email-pass">
                    Password, to confirm the email change
                  </label>
                  <input
                    id="acct-email-pass"
                    type="password"
                    className={`${FIELD} mt-1.5`}
                    value={passwordForEmail}
                    onChange={(e) => setPasswordForEmail(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="wb-note-line">
                  <span className="wb-ic"><IconCheck size={13} /></span>
                  <span>
                    We send a link to the new address first. The account moves only when you open it, so a typo
                    cannot lock you out.
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={saveEmail}
                    disabled={busy !== null || !newEmail.trim() || !passwordForEmail}
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
                  <label className={LABEL} htmlFor="acct-confirm-pass">
                    Password, to confirm deletion
                  </label>
                  <input
                    id="acct-confirm-pass"
                    type="password"
                    className={`${FIELD} mt-1.5`}
                    value={passwordForDelete}
                    onChange={(e) => setPasswordForDelete(e.target.value)}
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
                  disabled={busy !== null || confirmText !== 'DELETE' || (withPassword && !passwordForDelete)}
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
              /* A failure on this screen is not a polite status update: a
                 wrong password, an address already in use, a deletion that
                 did not happen. `status` is announced when the reader gets
                 round to it, which for these is too late to be useful. */
              role={feedback.tone === 'ok' ? 'status' : 'alert'}
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
