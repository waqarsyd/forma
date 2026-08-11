import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { transition, modalVariants } from '../lib/motion';
import { signInWithEmail, signUpWithEmail, signInWithGoogle, sendPasswordReset } from '../services/firebase';
import Logo from './Logo';
import { currentPath, navigate, onRouteChange } from '../lib/router';
import { IconEye, IconEyeOff, IconClose, IconWarn, IconInfo, IconSun, IconMoon } from './landing/icons';

interface LoginPageProps {
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'signin' | 'signup';
  isDarkMode?: boolean;
  setIsDarkMode?: (val: boolean) => void;
}

/** Firebase's own floor. Rejecting shorter client-side avoids a wasted round-trip. */
const MIN_PASSWORD = 6;

/**
 * Deliberately permissive: one @, no spaces, a dot in the domain. This exists to
 * catch typos before spending a request, not to adjudicate RFC 5322 — the server
 * is the authority, and a stricter pattern here would reject valid addresses.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type FieldKey = 'displayName' | 'email' | 'password' | 'confirmPassword';
type FieldErrors = Partial<Record<FieldKey, string>>;

interface FormValues {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

/**
 * Pure so the rules are readable in one place and stay identical between the
 * submit path and the on-blur path. Checks are ordered cheapest-and-most-
 * specific first: a too-short password reports its own length problem rather
 * than surfacing as "passwords do not match" against a half-typed confirmation.
 */
function validate(mode: 'signin' | 'signup', values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  const email = values.email.trim();
  const name = values.displayName.trim();

  if (!email) {
    errors.email = 'Enter your email address.';
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address, e.g. name@company.com';
  }

  if (!values.password) {
    errors.password = 'Enter your password.';
  } else if (mode === 'signup' && values.password.length < MIN_PASSWORD) {
    errors.password = `Use at least ${MIN_PASSWORD} characters.`;
  }

  if (mode === 'signup') {
    // Optional field — but whitespace-only is a mistake, not an opt-out, and
    // would otherwise reach updateProfile() as a blank display name.
    if (values.displayName && !name) {
      errors.displayName = 'Enter a name, or leave this blank.';
    } else if (name && name.length < 2) {
      errors.displayName = 'Use at least 2 characters, or leave this blank.';
    }

    if (!values.confirmPassword) {
      errors.confirmPassword = 'Re-enter your password to confirm it.';
    } else if (!errors.password && values.confirmPassword !== values.password) {
      errors.confirmPassword = 'Passwords do not match.';
    }
  }

  return errors;
}

/**
 * Firebase error code -> user-facing text. Never render `err.message` directly:
 * it carries the raw "Firebase: Error (auth/…)" envelope, and for sign-in it can
 * distinguish "no such user" from "wrong password" — an enumeration leak. Both
 * map to the same string here on purpose.
 *
 * A failed sign-in is a failure, always. There is deliberately no fallback that
 * fabricates a session when Firebase is misconfigured: a credential-free path
 * into the workspace is a bypass whether or not it is confined to dev builds,
 * and a misconfiguration must be visible rather than silently papered over.
 * The two configuration codes below therefore report the real problem.
 */
const AUTH_MESSAGES: Record<string, string> = {
  'auth/unauthorized-domain': 'Sign-in is not enabled for this domain. Add it to the Firebase authorized-domain list.',
  'auth/configuration-not-found': 'Email and password sign-in is not configured for this project.',
  'auth/invalid-credential': 'Invalid email or password.',
  'auth/user-not-found': 'Invalid email or password.',
  'auth/wrong-password': 'Invalid email or password.',
  'auth/invalid-email': 'Enter a valid email address, e.g. name@company.com',
  'auth/missing-password': 'Enter your password.',
  'auth/email-already-in-use': 'An account already exists with this email.',
  'auth/weak-password': `Password is too weak — use at least ${MIN_PASSWORD} characters.`,
  'auth/user-disabled': 'This account has been disabled. Contact support to restore it.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes before trying again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection and try again.',
  'auth/operation-not-allowed': 'Email and password sign-in is not enabled for this project.',
};

const LABEL =
  'font-code-sm text-[10px] font-medium leading-[1.62] tracking-[0.12em] uppercase text-[color:var(--ink-faint)]';

const fieldClass = (bad: boolean) =>
  `u-transition h-[46px] w-full rounded-[10px] border px-3.5 font-body-lg text-[14.5px] text-on-surface placeholder:text-[color:var(--ink-faint)] focus:outline-none focus:ring-4 disabled:opacity-60 ${
    bad
      ? 'border-error/50 bg-error/[0.07] focus:ring-error/15'
      : 'border-outline-variant bg-surface-container-low focus:border-secondary focus:bg-surface-container-lowest dark:focus:bg-card focus:ring-[color:var(--accent-wash)]'
  }`;

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p id={id} className="font-body-lg text-[12.5px] leading-[1.5] text-error">
      {message}
    </p>
  ) : null;

/**
 * The sign-in / sign-up surface.
 *
 * The logic below is the careful part of this file and was carried across
 * unchanged when the surface was rebuilt on 2026-08-11 — one pure validate(),
 * codes mapped through AUTH_MESSAGES rather than rendering err.message, both
 * credential failures resolving to one string, and no fallback that invents a
 * session when the project is misconfigured.
 *
 * What changed is presentation. The submit button had a blurred accent ring
 * pulsing behind it on an endless two-second loop while the user was typing
 * into the form above it; the footer carried a "Verified Stack" badge with a
 * shield icon, asserting a guarantee nobody had made; Privacy and Terms both
 * pointed at "/"; and the two buttons were the one place in the app that broke
 * the everything-is-a-pill rule. Creating an account was also buried in a
 * sentence below the Google button, so it is now a switch at the top.
 */
export default function LoginPage({
  onClose,
  onSuccess,
  initialMode = 'signin',
  isDarkMode,
  setIsDarkMode,
}: LoginPageProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  /**
   * Switching between sign-in and sign-up is a fresh start: a stale "Passwords
   * do not match" used to survive the switch and sit over a form that no longer
   * had a confirm field, and the typed password used to carry across with it.
   */
  const resetFormState = () => {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setPassword('');
    setConfirmPassword('');
  };

  const switchMode = (next: 'signin' | 'signup') => {
    if (next === mode) return;
    setMode(next);
    resetFormState();
    navigate(next === 'signup' ? '/signup' : '/login');
  };

  // Depends on `mode` so the "did it actually change?" test can live here rather
  // than inside the setState updater, which StrictMode double-invokes and which
  // must stay pure.
  useEffect(() => {
    const applyRoute = () => {
      const path = currentPath();
      const next = path === '/login' ? 'signin' : path === '/signup' ? 'signup' : null;
      if (!next || next === mode) return;
      setMode(next);
      resetFormState();
    };
    return onRouteChange(applyRoute);
  }, [mode]);

  /**
   * The dialog claims `aria-modal="true"`, and that claim carries two
   * obligations: Escape closes it, and focus stays inside it.
   *
   * Only the first was implemented once. Tab walked straight out of the dialog
   * and into the page behind — measured at 10 focusable elements inside against
   * 27 on the page — so a keyboard or screen-reader user could silently end up
   * operating a header they could not see past the backdrop. Escape is still
   * ignored mid-submit so a stray keypress cannot orphan an in-flight request.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) return;

      // `offsetParent === null` catches anything hidden — the confirm-password
      // field in sign-in mode, for instance — so the cycle only visits controls
      // the user can actually see.
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !dialog.contains(active);

      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, onClose]);

  /** Clear a field's error as soon as the user starts correcting it. */
  const clearFieldError = (key: FieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    try {
      await signInWithGoogle();
      onSuccess();
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        console.warn('Sign-in popup closed.');
      } else {
        console.error('Sign-in error:', err);
        // Not err.message — that is the raw "Firebase: Error (auth/…)" envelope.
        setError(AUTH_MESSAGES[err.code] ?? 'Google sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const values: FormValues = { displayName, email, password, confirmPassword };
    const errors = validate(mode, values);
    setFieldErrors(errors);
    setNotice(null);
    if (Object.keys(errors).length > 0) {
      // Each bad field states its own problem beneath itself; a second summary
      // banner saying "please fill in all fields" would only add noise.
      setError(null);
      const first = Object.keys(errors)[0] as FieldKey;
      document.getElementById(`auth-${first}`)?.focus();
      return;
    }

    // Trimmed on the way out, not on every keystroke — trimming in onChange
    // makes the space bar appear broken while typing.
    const cleanEmail = email.trim();
    const cleanName = displayName.trim();

    setLoading(true);
    setError(null);

    try {
      if (mode === 'signin') {
        await signInWithEmail(cleanEmail, password);
      } else {
        await signUpWithEmail(cleanEmail, password, cleanName || undefined);
      }
      onSuccess();
    } catch (err: any) {
      console.error('Email auth error:', err);
      // Every failure reports itself and stops here. There was once a branch that
      // signed the visitor in as a fabricated "Local Developer" when Firebase was
      // un-provisioned — and an earlier version of it matched on *message* text,
      // so `auth/network-request-failed` (message contains "network") let anyone
      // in with any password on a dropped connection. The whole fallback is gone;
      // a misconfigured project now says so instead of inventing a session.
      setError(AUTH_MESSAGES[err.code] ?? 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
      setFieldErrors((prev) => ({
        ...prev,
        email: 'Enter your email address above, then choose Forgot password.',
      }));
      document.getElementById('auth-email')?.focus();
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await sendPasswordReset(cleanEmail);
    } catch (err: any) {
      console.error('Password reset error:', err);
      // auth/user-not-found is swallowed on purpose — reporting it would confirm
      // which addresses have accounts. Anything else is a real failure worth
      // showing, since the user would otherwise wait for an email that is not coming.
      if (err.code && err.code !== 'auth/user-not-found') {
        setError(AUTH_MESSAGES[err.code] ?? 'Could not send the reset email. Please try again.');
        setLoading(false);
        return;
      }
    }
    setNotice(`If an account exists for ${cleanEmail}, a password reset link is on its way.`);
    setLoading(false);
  };

  const signup = mode === 'signup';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition.base}
      role="dialog"
      aria-modal="true"
      aria-label={signup ? 'Create an account' : 'Sign in'}
      className="landing sheet-grid fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-surface font-body-lg text-[16px] leading-[1.62] text-on-surface"
    >
      {/* ------------------------------------------------------- top bar */}
      <div className="flex shrink-0 items-center justify-between gap-4 px-margin-desktop py-[22px]">
        <div className="flex select-none items-center gap-[11px]">
          <Logo size={30} />
          <span className="flex flex-col">
            <span className="font-display-lg text-[20px] font-extrabold leading-[1.05] tracking-[-0.03em] text-on-surface">
              Forma
            </span>
            <span className="mt-px font-code-sm text-[8.5px] font-medium leading-[1.62] tracking-[0.2em] uppercase text-[color:var(--ink-faint)]">
              Show it · Build it · Ship it
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {setIsDarkMode && (
            <button
              type="button"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Switch theme"
              className="u-transition u-press u-focus-ring grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-full border border-outline-variant bg-surface-container-lowest/60 text-on-surface-variant hover:border-secondary hover:text-secondary"
            >
              {isDarkMode ? <IconMoon size={16} /> : <IconSun size={16} />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Back to home"
            aria-label="Close and return home"
            className="u-transition u-press u-focus-ring grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-full border border-outline-variant bg-surface-container-lowest/60 text-on-surface-variant hover:border-secondary hover:text-secondary"
          >
            <IconClose size={17} />
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- card */}
      <div className="flex flex-1 items-center justify-center px-4 pb-16 pt-2 sm:px-margin-desktop">
        <motion.div variants={modalVariants} initial="hidden" animate="visible" className="w-full max-w-[468px]">
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-card p-[30px] shadow-[var(--shadow-lg),var(--inset-hi)] sm:px-[38px] sm:py-9">
            <h1 className="font-display-lg text-[27px] font-extrabold leading-[1.15] tracking-[-0.03em] text-on-surface">
              {signup ? 'Create your account' : 'Sign in to Forma'}
            </h1>
            <p className="mt-2 font-body-lg text-[14.5px] leading-[1.55] text-on-surface-variant">
              {signup
                ? 'Free, and it takes about twenty seconds.'
                : 'Your projects, on every machine you sign in from.'}
            </p>

            {/* Both modes visible at once. Sign-up used to be one sentence at
                the very bottom of the card, under the Google button. */}
            <div
              role="tablist"
              aria-label="Sign in or create an account"
              className="mt-[22px] grid grid-cols-2 gap-1 rounded-full border border-outline-variant bg-surface-container-low p-1"
            >
              {([
                ['signin', 'Sign in'],
                ['signup', 'Create account'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  disabled={loading}
                  onClick={() => switchMode(value)}
                  className={`u-transition cursor-pointer rounded-full px-3 py-2.5 font-body-lg text-[13.5px] font-semibold disabled:pointer-events-none disabled:opacity-60 ${
                    mode === value
                      ? 'bg-surface-container-lowest dark:bg-card text-on-surface shadow-[var(--shadow-sm)]'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={transition.fast}
                  role="alert"
                  className="overflow-hidden"
                >
                  <div className="mt-[18px] flex items-start gap-3 rounded-[10px] border border-error/40 bg-error/[0.08] px-4 py-3.5 font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant">
                    <IconWarn size={17} className="mt-0.5 shrink-0 text-error" />
                    <span>{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {notice && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={transition.fast}
                  role="status"
                  className="overflow-hidden"
                >
                  <div className="mt-[18px] flex items-start gap-3 rounded-[10px] border border-outline-variant bg-surface-container-low px-4 py-3.5 font-body-lg text-[13.5px] leading-[1.55] text-on-surface-variant">
                    <IconInfo size={17} className="mt-0.5 shrink-0 text-[color:var(--ink-faint)]" />
                    <span>{notice}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <form
              onSubmit={handleSubmit}
              // validate() owns the rules. Left to the browser, `required` and
              // type="email" would block submit with a native bubble whose
              // wording and styling we do not control, so the two mechanisms
              // would disagree about the same field.
              noValidate
              className="mt-[22px] grid gap-[15px]"
            >
              {signup && (
                <div className="grid gap-[7px]">
                  <label htmlFor="auth-displayName" className={LABEL}>
                    Name <span className="font-body-lg text-[11.5px] normal-case tracking-normal">optional</span>
                  </label>
                  <input
                    id="auth-displayName"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      clearFieldError('displayName');
                    }}
                    disabled={loading}
                    aria-invalid={!!fieldErrors.displayName}
                    aria-describedby={fieldErrors.displayName ? 'auth-name-error' : undefined}
                    placeholder="Alex Riviera"
                    className={fieldClass(!!fieldErrors.displayName)}
                  />
                  <FieldError id="auth-name-error" message={fieldErrors.displayName} />
                </div>
              )}

              <div className="grid gap-[7px]">
                <label htmlFor="auth-email" className={LABEL}>
                  Email address
                </label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  // Under noValidate this blocks nothing — it is kept purely so
                  // assistive tech still announces the field as required.
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError('email');
                  }}
                  disabled={loading}
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                  placeholder="name@example.com"
                  className={fieldClass(!!fieldErrors.email)}
                />
                <FieldError id="auth-email-error" message={fieldErrors.email} />
              </div>

              <div className="grid gap-[7px]">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="auth-password" className={LABEL}>
                    Password
                  </label>
                  {!signup && (
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={loading}
                      className="u-focus-ring u-transition-fast cursor-pointer rounded px-1 py-0.5 font-code-sm text-[10.5px] tracking-[0.04em] text-secondary hover:underline disabled:pointer-events-none disabled:opacity-50"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="auth-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={signup ? 'new-password' : 'current-password'}
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError('password');
                      clearFieldError('confirmPassword');
                    }}
                    disabled={loading}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
                    placeholder="••••••••"
                    className={`${fieldClass(!!fieldErrors.password)} pr-12`}
                  />
                  {/* One control drives both fields, so a signup form cannot end
                      up with one shown and the other hidden. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="u-focus-ring u-transition-fast absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-[color:var(--ink-faint)] hover:bg-surface-container-high hover:text-on-surface"
                  >
                    {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                </div>
                <FieldError id="auth-password-error" message={fieldErrors.password} />
                {signup && !fieldErrors.password && (
                  <p className="font-body-lg text-[12.5px] leading-[1.5] text-[color:var(--ink-faint)]">
                    At least {MIN_PASSWORD} characters.
                  </p>
                )}
              </div>

              {signup && (
                <div className="grid gap-[7px]">
                  <label htmlFor="auth-confirmPassword" className={LABEL}>
                    Confirm password
                  </label>
                  <input
                    id="auth-confirmPassword"
                    name="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      clearFieldError('confirmPassword');
                    }}
                    disabled={loading}
                    aria-invalid={!!fieldErrors.confirmPassword}
                    aria-describedby={fieldErrors.confirmPassword ? 'auth-confirm-error' : undefined}
                    placeholder="••••••••"
                    className={fieldClass(!!fieldErrors.confirmPassword)}
                  />
                  <FieldError id="auth-confirm-error" message={fieldErrors.confirmPassword} />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="u-transition u-press u-focus-ring inline-flex h-[46px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-secondary-container font-body-lg text-[14.5px] font-semibold text-white shadow-[0_1px_2px_rgba(8,24,43,0.1)] hover:bg-[color:var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <span className="h-[17px] w-[17px] animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span className="sr-only">Submitting</span>
                  </>
                ) : signup ? (
                  'Create account'
                ) : (
                  'Sign in'
                )}
              </button>
            </form>

            <div className="my-[22px] flex items-center gap-3.5">
              <span className="h-px flex-1 bg-outline-variant" />
              <span className="whitespace-nowrap font-code-sm text-[9.5px] font-medium tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
                {signup ? 'or sign up with' : 'or continue with'}
              </span>
              <span className="h-px flex-1 bg-outline-variant" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="u-transition u-press u-focus-ring inline-flex h-[46px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-full border border-outline bg-surface-container-lowest dark:bg-card font-body-lg text-[14.5px] font-semibold text-on-surface hover:border-[color:var(--ink-faint)] hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg className="h-[17px] w-[17px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
              </svg>
              {signup ? 'Sign up with Google' : 'Sign in with Google'}
            </button>
          </div>

          {/* An account is optional here, and saying so removes the main reason
              someone bounces off a sign-in wall. */}
          <div className="mt-[18px] rounded-xl border border-outline-variant bg-surface-container-lowest/55 dark:bg-card/55 px-[18px] py-4">
            <div className="font-code-sm text-[9.5px] font-medium leading-[1.62] tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
              You may not need this
            </div>
            <p className="mt-1.5 font-body-lg text-[13.5px] leading-[1.58] text-on-surface-variant">
              Forma works fully signed out — your projects are kept in this browser and are still there when
              you come back. An account only adds syncing across machines and the encrypted copy of your API
              key.{' '}
              <button
                type="button"
                onClick={onClose}
                className="u-focus-ring cursor-pointer rounded font-semibold text-secondary hover:underline"
              >
                Go straight to the workspace
              </button>
              .
            </p>
          </div>
        </motion.div>
      </div>

      {/* -------------------------------------------------------- footer */}
      <footer className="mt-auto w-full shrink-0 border-t border-outline-variant bg-surface-container-lowest dark:bg-card">
        <div className="mx-auto flex max-w-container-max flex-wrap items-center justify-between gap-x-5 gap-y-3 px-margin-desktop py-[18px]">
          <p className="font-body-lg text-[12.5px] text-[color:var(--ink-faint)]">
            © 2026 Forma. Designed &amp; built by <b className="font-bold text-secondary">Waqar Sayyed</b>.
          </p>
          {/* Marked rather than faked: both of these pointed at "/" before. */}
          <div className="flex items-center gap-[18px]">
            <a href="#" data-needs-url className="u-transition-fast font-body-lg text-[12.5px] text-[color:var(--ink-faint)] hover:text-secondary">
              Privacy
            </a>
            <a href="#" data-needs-url className="u-transition-fast font-body-lg text-[12.5px] text-[color:var(--ink-faint)] hover:text-secondary">
              Terms
            </a>
          </div>
        </div>
        <div className="flex justify-center border-t border-outline-variant py-4">
          <span className="font-code-sm text-[10.5px] font-medium tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
            Crafting the future of report generation.
          </span>
        </div>
      </footer>
    </motion.div>
  );
}
