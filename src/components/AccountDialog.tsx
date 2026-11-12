import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { User } from 'firebase/auth';
import {
  changePassword,
  deleteAccountAndData,
  hasPasswordProvider,
  refreshVerification,
  requestEmailChange,
  sendVerificationEmail,
  setDisplayName,
} from '../services/firebase';
import { IconKey, IconMail, IconTrash, IconUser, IconWarn } from './landing/icons';
import { MIN_PASSWORD } from '../lib/passwordPolicy';
import SectionedDialog, { type DialogSection } from './SectionedDialog';

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
 *
 * **Shaped as Settings since 2026-11-07** (the owner's request, the day
 * Settings became ChatGPT's): the same frame, SectionedDialog, with Profile,
 * Password, Email address and Delete account on the left — the middle two
 * for a password account only, Google holding the rest — and each section
 * a row of its fields and its one button. Until then it was two columns in
 * the drafting style of the 2026-08-12 port, every section on one screen.
 * The rules above held through the move: each section keeps its own password
 * state, and since state outlives a section change, typing in one still
 * cannot arm another. The line that says what happened sits at the foot of
 * the section it happened in, and goes when the section changes.
 */

type AccountSection = 'profile' | 'password' | 'email' | 'delete';

type Feedback = { tone: 'ok' | 'error'; text: string } | null;

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That password is not right.',
  'auth/wrong-password': 'That password is not right.',
  'auth/missing-password': 'Enter your current password.',
  'auth/weak-password': `Use at least ${MIN_PASSWORD} characters.`,
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
  // The deletion stops before anything is removed when the learning events
  // cannot be (2026-11-11, the full audit, LM-02; lib/accountData.ts).
  'forma/learning-not-deleted': 'Your learning data could not be deleted yet; nothing else was removed. Try again in a moment.',
};

const messageFor = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  return (code && AUTH_MESSAGES[code]) || 'That did not work. Please try again.';
};

/*
 * The fields are dialogs.css's, as Settings' are: one border that darkens when
 * focused and no outline of its own. The Tailwind fields this dialog had until
 * 2026-09-08 drew three focus treatments stacked, read as a doubled border, and
 * then `.wb-lbl`/`.wb-ctl` replaced them (app-shell.md, *The dialog drew two
 * borders around a focused field*); those went in turn on 2026-11-07.
 */
const FIELD = 'wb-set-input';

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
  const [section, setSection] = useState<AccountSection>('profile');

  /*
   * Whether the address is verified, checked rather than trusted (2026-11-11,
   * the full audit, SA-08). `user.emailVerified` does not change when the link
   * is opened in another tab, so this said "not verified yet" until a reload,
   * and the token the database reads stayed stale an hour after that.
   * `refreshVerification` reloads the user and refreshes the token; it runs
   * once when the dialog opens on an unverified account, and on "I've
   * verified it". A failure leaves the notice as it was, which is what it
   * showed before the check existed.
   */
  const [verified, setVerified] = useState(user.emailVerified);
  const recheckVerified = async (): Promise<boolean> => {
    try {
      const ok = await refreshVerification(user);
      if (ok) setVerified(true);
      return ok;
    } catch (error) {
      console.warn('Could not check whether the address is verified:', error);
      return false;
    }
  };
  useEffect(() => {
    if (withPassword && !user.emailVerified) void recheckVerified();
  }, [user]);

  const sections: DialogSection<AccountSection>[] = [
    { id: 'profile', label: 'Profile', Icon: IconUser },
    ...(withPassword
      ? ([
          { id: 'password', label: 'Password', Icon: IconKey },
          { id: 'email', label: 'Email address', Icon: IconMail },
        ] as DialogSection<AccountSection>[])
      : []),
    { id: 'delete', label: 'Delete account', Icon: IconTrash },
  ];
  /** A line about what happened belongs to the section it happened in. */
  const openSection = (next: AccountSection) => {
    setSection(next);
    setFeedback(null);
  };

  /**
   * Not for the focus trap — SectionedDialog holds that. This one guards the
   * one place `onClose` is called from inside an `await`: deleting the account
   * re-renders this component while the request is in flight, and the ref makes
   * sure the callback that runs afterwards is the current one rather than the
   * one captured when the button was clicked.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

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

  /** "I've verified it": the same check, at once, saying what it found. */
  const confirmVerified = async () => {
    setBusy('recheck');
    setFeedback(null);
    const ok = await recheckVerified();
    setBusy(null);
    setFeedback(ok ? { tone: 'ok', text: 'Your address is verified.' } : { tone: 'error', text: 'It is not verified yet. Open the link in the email from Forma, then try again.' });
  };

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
    passwordForChange.length > 0 && nextPassword.length >= MIN_PASSWORD && nextPassword === confirmPassword;
  const canSaveName = busy === null && !nameTooShort && !nameUnchanged;
  const canSavePassword = busy === null && canChangePassword;
  const canSaveEmail = busy === null && !!newEmail.trim() && !!passwordForEmail;

  /*
   * Enter in a field does what its section's button does, when that button
   * could be pressed (2026-11-12, the end-to-end retest): the fields sit in no
   * form, so Enter did nothing and a name typed and "entered" stayed unsaved.
   * Not in the delete section, which stays a deliberate click.
   */
  const onEnter = (ready: boolean, act: () => unknown) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || !ready) return;
    e.preventDefault();
    void act();
  };

  return (
    <SectionedDialog title="Your account" sections={sections} section={section} onSection={openSection} onClose={onClose}>
      {section === 'profile' && (
        <>
          <div className="wb-set-row">
            <div className="wb-set-text">
              <span className="wb-set-label">Signed in as</span>
              <p>
                <b className="wb-set-strong">{user.email}</b>
              </p>
              <p>{withPassword ? 'Email and password account.' : 'Signed in with Google.'}</p>
            </div>
          </div>

          {/* Only password accounts can be unverified: Google has already
              proved the address by the time the popup closes. */}
          {withPassword && !verified && (
            <div className="wb-set-row is-stack">
              <p className="wb-set-note is-bad">
                <IconWarn size={13} />
                <span>
                  <b>This address is not verified yet.</b> Check your inbox for the link we sent when the account was created.{' '}
                  <button type="button" className="wb-set-link" onClick={resend} disabled={busy !== null || verificationSent}>
                    {verificationSent ? 'Sent' : busy === 'verify' ? 'Sending…' : 'Send it again'}
                  </button>{' '}
                  <button type="button" className="wb-set-link" onClick={() => void confirmVerified()} disabled={busy !== null}>
                    {busy === 'recheck' ? 'Checking…' : "I've verified it"}
                  </button>
                </span>
              </p>
            </div>
          )}

          <div className="wb-set-row is-stack">
            <div className="wb-set-text">
              <label className="wb-set-label" htmlFor="acct-name">Display name</label>
            </div>
            <div className="wb-set-field">
              {/* Paired with the hint below, the way ContactPage's Field and
                  LoginPage's fields already do it. The message was visible
                  text with no programmatic relationship to the box it
                  belonged to, so a screen reader announced neither that the
                  value was rejected nor why — see the comment in
                  ContactPage's Field for the full reasoning. */}
              <input
                id="acct-name"
                className={FIELD}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onEnter(canSaveName, saveName)}
                placeholder="Your name"
                autoComplete="name"
                aria-invalid={nameTooShort}
                aria-describedby={nameTooShort ? 'acct-name-error' : undefined}
              />
              <button type="button" onClick={saveName} disabled={!canSaveName} className="wb-pill wb-pill--outline">
                {busy === 'name' ? 'Saving…' : 'Save'}
              </button>
            </div>
            {nameTooShort && (
              <p id="acct-name-error" className="wb-set-note is-bad">
                Use at least 2 characters.
              </p>
            )}
          </div>
        </>
      )}

      {section === 'password' && withPassword && (
        <div className="wb-set-row is-stack">
          <div className="wb-set-text">
            <span className="wb-set-label">Change your password</span>
            <p>Your current password, then the new one twice, as sign-up asks for it.</p>
          </div>
          <div className="wb-set-fieldset">
            <label htmlFor="acct-current">Current password</label>
            <input
              id="acct-current"
              type="password"
              className={FIELD}
              value={passwordForChange}
              onChange={(e) => setPasswordForChange(e.target.value)}
              onKeyDown={onEnter(canSavePassword, savePassword)}
              autoComplete="current-password"
            />
          </div>
          <div className="wb-set-fieldset">
            <label htmlFor="acct-next">New password</label>
            <input
              id="acct-next"
              type="password"
              className={FIELD}
              value={nextPassword}
              onChange={(e) => setNextPassword(e.target.value)}
              onKeyDown={onEnter(canSavePassword, savePassword)}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              autoComplete="new-password"
            />
          </div>
          {/* Typed twice, as sign-up asks for it. Without this a typo sets a
              password the owner does not know, and they find out at the next
              sign-in on another device — long after they could connect it to
              this screen. */}
          <div className="wb-set-fieldset">
            <label htmlFor="acct-next-confirm">Confirm new password</label>
            <input
              id="acct-next-confirm"
              type="password"
              className={FIELD}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={onEnter(canSavePassword, savePassword)}
              placeholder="Type it again"
              autoComplete="new-password"
              aria-invalid={passwordsDiffer}
              aria-describedby={passwordsDiffer ? 'acct-confirm-error' : undefined}
            />
            {passwordsDiffer && (
              <p id="acct-confirm-error" className="wb-set-note is-bad">
                Those two do not match.
              </p>
            )}
          </div>
          <div className="wb-set-actions">
            <button type="button" onClick={savePassword} disabled={!canSavePassword} className="wb-pill wb-pill--outline">
              {busy === 'password' ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </div>
      )}

      {section === 'email' && withPassword && (
        <div className="wb-set-row is-stack">
          <div className="wb-set-text">
            <span className="wb-set-label">Move the account to another address</span>
            <p>We send a link to the new address first. The account moves only when you open it, so a typo cannot lock you out.</p>
          </div>
          <div className="wb-set-fieldset">
            <label htmlFor="acct-email">New email address</label>
            <input
              id="acct-email"
              type="email"
              className={FIELD}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={onEnter(canSaveEmail, saveEmail)}
              placeholder="name@company.com"
              autoComplete="email"
            />
          </div>
          {/* Its own field. This section required a password and had no
              input, so the one it read lived in the Password fieldset in the
              other column — the button stayed disabled and nothing on screen
              said which box would enable it. */}
          <div className="wb-set-fieldset">
            <label htmlFor="acct-email-pass">Password, to confirm the email change</label>
            <input
              id="acct-email-pass"
              type="password"
              className={FIELD}
              value={passwordForEmail}
              onChange={(e) => setPasswordForEmail(e.target.value)}
              onKeyDown={onEnter(canSaveEmail, saveEmail)}
              autoComplete="current-password"
            />
          </div>
          <div className="wb-set-actions">
            <button type="button" onClick={saveEmail} disabled={!canSaveEmail} className="wb-pill wb-pill--outline">
              {busy === 'email' ? 'Sending…' : 'Send confirmation'}
            </button>
          </div>
        </div>
      )}

      {section === 'delete' && (
        <div className="wb-set-row is-stack">
          <div className="wb-set-text">
            <span className="wb-set-label">Delete your account</span>
            <p>
              {/* Everything deleteAccountData removes (2026-11-11, the full audit's SA-06b): learning was missing. */}
              <b className="wb-set-strong">This cannot be undone.</b> Your projects with their revisions, every report you shared, what you let Forma
              learn from, and the encrypted copy of your API key are deleted with the account. Reports kept only in this browser are not touched.
            </p>
          </div>
          {withPassword && (
            <div className="wb-set-fieldset">
              <label htmlFor="acct-confirm-pass">Password, to confirm deletion</label>
              <input
                id="acct-confirm-pass"
                type="password"
                className={FIELD}
                value={passwordForDelete}
                onChange={(e) => setPasswordForDelete(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          )}
          <div className="wb-set-fieldset">
            <label htmlFor="acct-confirm">Type DELETE to confirm</label>
            <input
              id="acct-confirm"
              className={FIELD}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>
          <div className="wb-set-actions">
            <button
              type="button"
              onClick={removeAccount}
              disabled={busy !== null || confirmText !== 'DELETE' || (withPassword && !passwordForDelete)}
              /* `.wb-pill--danger`, not `.wb-pill` plus Tailwind's error
                 colours: the pill declares its own colour, background and
                 border, and workspace.css loads after the utilities, so it
                 wins and the button renders as bare text. See the rule's
                 own comment in workspace.css. */
              className="wb-pill wb-pill--danger"
            >
              <IconTrash size={14} />
              {busy === 'delete' ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <p
          className={`wb-set-note ${feedback.tone === 'ok' ? 'is-ok' : 'is-bad'}`}
          /* A failure on this screen is not a polite status update: a wrong
             password, an address already in use, a deletion that did not
             happen. `status` is announced when the reader gets round to it,
             which for these is too late to be useful. */
          role={feedback.tone === 'ok' ? 'status' : 'alert'}
        >
          {feedback.text}
        </p>
      )}
    </SectionedDialog>
  );
}
