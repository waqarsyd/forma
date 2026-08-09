import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { transition, modalVariants } from '../lib/motion';
import { Eye, EyeOff, X } from 'lucide-react';
import { signInWithEmail, signUpWithEmail, signInWithGoogle, sendPasswordReset } from '../services/firebase';
import Logo from './Logo';

interface LoginPageProps {
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'signin' | 'signup';
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

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p id={id} className="font-body-sm text-[11px] text-error mt-1.5 text-left">
      {message}
    </p>
  ) : null;

export default function LoginPage({ onClose, onSuccess, initialMode = 'signin' }: LoginPageProps) {
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
  const prefersReduced = useReducedMotion();

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
    setMode(next);
    resetFormState();
    window.location.hash = next === 'signup' ? 'signup' : 'login';
  };

  // Depends on `mode` so the "did it actually change?" test can live here rather
  // than inside the setState updater, which StrictMode double-invokes and which
  // must stay pure.
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      const next = hash === '#login' ? 'signin' : hash === '#signup' ? 'signup' : null;
      if (!next || next === mode) return;
      setMode(next);
      resetFormState();
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [mode]);

  /**
   * The dialog claims `aria-modal="true"`, and that claim carries two
   * obligations: Escape closes it, and focus stays inside it.
   *
   * Only the first was implemented. Tab walked straight out of the dialog and
   * into the page behind — measured at 10 focusable elements inside against 27
   * on the page — so a keyboard or screen-reader user could silently end up
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
        email: 'Enter your email address above, then choose Forgot Password.',
      }));
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition.base}
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'signin' ? 'Sign in' : 'Create an account'}
      className="fixed inset-0 z-[100] bg-surface text-on-surface flex flex-col font-body-lg overflow-y-auto"
    >
      {/* Top Header Row with Logo and Close Button */}
      <div className="w-full flex justify-between items-start gap-3 p-4 sm:p-6 md:p-8 shrink-0">
        <div className="flex items-center gap-4 select-none">
          <Logo size={32} />
          <div className="flex flex-col">
            <span className="font-display-lg text-title-md font-bold text-primary tracking-tight">Forma</span>
            <span className="font-label-caps text-[9px] tracking-widest text-on-surface-variant uppercase leading-none mt-1">
              SHOW IT. BUILD IT. SHIP IT.
            </span>
          </div>
        </div>
        <motion.button
          whileHover={prefersReduced ? undefined : { scale: 1.1, rotate: 90 }}
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className="u-tap u-focus-ring shrink-0 w-10 h-10 text-on-surface-variant hover:text-primary hover:bg-surface-container-low rounded-full u-transition-fast cursor-pointer flex items-center justify-center"
          title="Back to home"
          aria-label="Close and return home"
        >
          <X size={20} />
        </motion.button>
      </div>

      {/* Ambient shapes. Static: four blurred circles drifting forever behind a
          login form is motion competing with the thing the user came to do. */}
      {[
        { size: 120, top: '5%', left: '3%', color: 'bg-secondary-container/8' },
        { size: 80, top: '15%', right: '5%', color: 'bg-violet-400/8' },
        { size: 60, bottom: '10%', left: '8%', color: 'bg-blue-400/8' },
        { size: 100, bottom: '20%', right: '3%', color: 'bg-amber-400/8' },
      ].map((s, i) => (
        <div
          key={i}
          className={`absolute rounded-full blur-2xl pointer-events-none hidden sm:block ${s.color}`}
          style={{ width: s.size, height: s.size, top: s.top, left: (s as any).left, right: (s as any).right, bottom: (s as any).bottom }}
        />
      ))}

      {/* Main Centered Content */}
      <div className="flex-1 flex items-center justify-center px-3 sm:px-4 py-6 sm:py-8">
        <motion.div
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          className="bg-surface-container-lowest border border-outline-variant/40 shadow-[0_4px_24px_rgba(11,28,48,0.04)] rounded-3xl w-full max-w-[480px] p-6 sm:p-8 md:p-10"
        >

          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={transition.fast}
              className="text-center mb-6 sm:mb-8"
            >
              <h2 className="font-display-lg text-headline-lg font-bold text-on-surface mb-2 tracking-tight">
                {mode === 'signin' ? 'Sign In to Forma' : 'Create an Account'}
              </h2>
              <p className="font-body-sm text-on-surface-variant text-sm">
                {mode === 'signin'
                  ? 'Enter your credentials to access Forma'
                  : 'Get started with our intelligent layout parsing system'}
              </p>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={transition.fast}
                role="alert"
                className="overflow-hidden"
              >
                {/* Was animate-pulse — an error that throbs indefinitely is
                    hard to read and fails reduced-motion expectations. */}
                <div className="bg-error-container border border-error/30 text-on-error-container p-3 rounded-xl text-xs font-medium">
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {notice && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={transition.fast}
                role="status"
                className="overflow-hidden"
              >
                <div className="bg-surface border border-outline-variant text-on-surface-variant p-3 rounded-xl text-xs font-medium">
                  {notice}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.form
              key={mode}
              initial={{ opacity: 0, x: mode === 'signup' ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: mode === 'signup' ? -20 : 20 }}
              transition={transition.base}
              onSubmit={handleSubmit}
              // validate() owns the rules. Left to the browser, `required` and
              // type="email" would block submit with a native bubble whose
              // wording and styling we do not control, so the two mechanisms
              // would disagree about the same field.
              noValidate
              className="space-y-5"
            >
            {mode === 'signup' && (
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...transition.fast, delay: 0.03 }}
                className="space-y-1.5 text-left"
              >
                <label htmlFor="auth-name" className="block font-code-sm text-[11px] text-on-surface-variant uppercase tracking-wider">
                  Full Name <span className="text-outline normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="auth-name"
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
                  placeholder="John Doe"
                  className={`w-full h-11 px-4 border rounded-xl text-sm text-on-surface bg-surface focus:outline-none focus:ring-2 u-transition disabled:opacity-60 ${
                    fieldErrors.displayName
                      ? 'border-error focus:border-error focus:ring-error/20'
                      : 'border-outline-variant focus:border-on-surface focus:ring-on-surface/20'
                  }`}
                />
                <FieldError id="auth-name-error" message={fieldErrors.displayName} />
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...transition.fast, delay: 0.06 }}
              className="space-y-1.5 text-left"
            >
              <label htmlFor="auth-email" className="block font-code-sm text-[11px] text-on-surface-variant uppercase tracking-wider">
                Email Address
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
                placeholder="name@company.com"
                className={`w-full h-11 px-4 border rounded-xl text-sm text-on-surface bg-surface focus:outline-none focus:ring-2 u-transition disabled:opacity-60 ${
                  fieldErrors.email
                    ? 'border-error focus:border-error focus:ring-error/20'
                    : 'border-outline-variant focus:border-on-surface focus:ring-on-surface/20'
                }`}
              />
              <FieldError id="auth-email-error" message={fieldErrors.email} />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...transition.fast, delay: 0.09 }}
              className="space-y-1.5 text-left"
            >
              <div className="flex justify-between items-center">
                <label htmlFor="auth-password" className="font-code-sm text-[11px] text-on-surface-variant uppercase tracking-wider">
                  Password
                </label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={handlePasswordReset}
                    disabled={loading}
                    className="u-focus-ring u-transition-fast font-code-sm text-[11px] text-secondary hover:text-secondary-container tracking-wide cursor-pointer rounded px-1 py-0.5 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
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
                  className={`w-full h-11 pl-4 pr-12 border rounded-xl text-sm text-on-surface bg-surface focus:outline-none focus:ring-2 u-transition disabled:opacity-60 ${
                    fieldErrors.password
                      ? 'border-error focus:border-error focus:ring-error/20'
                      : 'border-outline-variant focus:border-on-surface focus:ring-on-surface/20'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="u-focus-ring u-transition-fast absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-outline hover:text-on-surface hover:bg-card cursor-pointer"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <FieldError id="auth-password-error" message={fieldErrors.password} />
              {mode === 'signup' && !fieldErrors.password && (
                <p className="font-body-sm text-[11px] text-on-surface-variant mt-1.5 text-left">
                  At least {MIN_PASSWORD} characters.
                </p>
              )}
            </motion.div>

            {mode === 'signup' && (
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...transition.fast, delay: 0.12 }}
                className="space-y-1.5 text-left"
              >
                <label htmlFor="auth-confirm" className="block font-code-sm text-[11px] text-on-surface-variant uppercase tracking-wider">
                  Confirm Password
                </label>
                <input
                  id="auth-confirm"
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
                  className={`w-full h-11 px-4 border rounded-xl text-sm text-on-surface bg-surface focus:outline-none focus:ring-2 u-transition disabled:opacity-60 ${
                    fieldErrors.confirmPassword
                      ? 'border-error focus:border-error focus:ring-error/20'
                      : 'border-outline-variant focus:border-on-surface focus:ring-on-surface/20'
                  }`}
                />
                <FieldError id="auth-confirm-error" message={fieldErrors.confirmPassword} />
              </motion.div>
            )}

            <div className="relative">
              {/* Pulsing glow ring behind submit button. Paused while the form
                  is submitting so the spinner is the only thing moving. */}
              {!prefersReduced && !loading && (
                <motion.div
                  className="absolute inset-0 rounded-xl bg-secondary-container/30 blur-md pointer-events-none"
                  animate={{ scale: [1, 1.06, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                />
              )}
              <motion.button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                whileHover={prefersReduced ? undefined : { scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="u-focus-ring relative w-full h-11 bg-secondary-container hover:bg-[#e05a00] active:bg-[#c04d00] text-white font-label-caps text-xs uppercase tracking-wider rounded-xl font-bold shadow-md hover:shadow-lg u-transition disabled:opacity-60 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span className="sr-only">Submitting</span>
                  </>
                ) : mode === 'signin' ? (
                  'Sign In'
                ) : (
                  'Create Account'
                )}
              </motion.button>
            </div>
          </motion.form>
        </AnimatePresence>

          <div className="relative my-6 sm:my-8">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-outline-variant/40"></div>
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-label-caps tracking-widest text-outline bg-surface-container-lowest px-3 select-none">
              {mode === 'signin' ? 'Or sign in with' : 'Or sign up with'}
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="u-press u-focus-ring w-full h-11 border border-outline-variant hover:border-on-surface text-on-surface bg-surface-container-lowest font-label-caps text-xs uppercase tracking-wider rounded-xl font-semibold u-transition hover:bg-surface disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-2.5 shadow-sm"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="#EA4335"
              />
            </svg>
            {mode === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}
          </button>

          <div className="mt-8 text-center text-sm font-body-sm text-on-surface-variant">
            {mode === 'signin' ? (
              <>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  disabled={loading}
                  className="u-focus-ring u-transition-fast text-secondary hover:text-secondary-container font-semibold cursor-pointer rounded px-1 py-0.5 disabled:opacity-50 disabled:pointer-events-none"
                >
                  Sign Up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  disabled={loading}
                  className="u-focus-ring u-transition-fast text-secondary hover:text-secondary-container font-semibold cursor-pointer rounded px-1 py-0.5 disabled:opacity-50 disabled:pointer-events-none"
                >
                  Sign In
                </button>
              </>
            )}
          </div>

        </motion.div>
      </div>

      {/* Footer */}
      <footer className="w-full bg-surface py-6 shrink-0 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-[11px] text-on-surface-variant font-sans text-center md:text-left">
          {/* Left side: Logo, brand, tagline */}
          <div className="flex items-center justify-center md:justify-start gap-3 flex-wrap">
            <div className="flex items-center gap-2 select-none shrink-0">
              <Logo size={20} />
              <span className="font-bold text-sm text-secondary-container">Forma</span>
            </div>
            <div className="h-5 w-px bg-outline-variant/60 hidden sm:block"></div>
            <p className="font-body-sm text-[12px] leading-relaxed text-on-surface-variant max-w-[340px] text-center md:text-left">
              © 2026 Forma. All rights reserved.<br />Designed & Built by <strong className="text-secondary-container font-bold">Waqar Sayyed</strong>
            </p>
          </div>

          {/* Right side: Privacy, Terms, and Verified Stack */}
          <div className="flex items-center justify-center gap-4 flex-wrap lg:justify-end select-none text-[12px]">
            <a href="#" className="u-focus-ring u-transition-fast hover:text-primary rounded px-1 py-0.5">Privacy</a>
            <span className="text-outline-variant text-[21px] font-bold" aria-hidden="true">•</span>
            <a href="#" className="u-focus-ring u-transition-fast hover:text-primary rounded px-1 py-0.5">Terms</a>
            <span className="text-outline-variant text-[21px] font-bold" aria-hidden="true">•</span>
            <div className="flex items-center gap-1.5 text-outline/70 font-mono text-[9px] uppercase tracking-wider font-bold select-none">
              <svg className="w-3.5 h-3.5 text-outline/70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              Verified Stack
            </div>
          </div>
        </div>
      </footer>

      {/* Sub Footer */}
      <div className="w-full bg-surface dark:bg-card py-4 border-t border-outline-variant/30 text-center select-none shrink-0">
        <span className="text-[10px] uppercase font-mono text-on-surface-variant">
          Crafting the future of report generation.
        </span>
      </div>
    </motion.div>
  );
}
