import { useState, type ReactNode } from 'react';
import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SheetRuler from './landing/SheetRuler';
import Logo from './Logo';
import {
  IconMail, IconCheck, IconWarn, IconChevronDown, IconArrowRight, IconExternal,
  IconGitHub, IconLinkedIn, IconDiscord, IconPortfolio,
} from './landing/icons';

/**
 * The contact page.
 *
 * Rebuilt on 2026-08-11. Three things in the previous version were not true,
 * and none of them is reproduced here:
 *
 *  - the visible support address did not match the mailto behind it;
 *  - Github, Discord and LinkedIn all linked to "/";
 *  - and the catch block around the send set the success state, so a failed
 *    request told the sender "we've received your message" while the message
 *    was dropped. That is the one that mattered: a support request lost while
 *    the person believes it landed.
 *
 * The address is now never written into the markup. It is held as two halves
 * and joined only when someone asks for it, so a harvester reading the served
 * HTML finds no `name@host` and no mailto: to follow. That stops the scrapers
 * that regex over markup, which is nearly all of them; it is not proof against
 * one that executes this file. The structural fix is an alias that can be
 * rotated, which is a mailbox decision rather than a code one.
 */

interface ContactPageProps {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

/* The address, in halves. Never assemble these at module scope into a
   constant — that puts the literal back into the bundle. */
const MAIL_USER = 'waqarsayyed.official';
const MAIL_HOST = ['gmail', 'com'].join('.');
const mailAddress = () => `${MAIL_USER}${String.fromCharCode(64)}${MAIL_HOST}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const TOPICS = [
  'A layout came out wrong',
  'The designer will not open the file',
  'An error message',
  'A security issue',
  'An idea or feature request',
  'Something else',
];

const ROUTES: Array<[string, ReactNode]> = [
  ['A wrong layout', 'The file you uploaded, and what came back. The original PDF beats a screenshot of it — that is usually the whole explanation.'],
  ['A file the designer rejects', <>The generated <code className="doc-code">.repx</code> and your DevExpress version. The XML is checked in the browser first, so this one is worth reporting.</>],
  ['An error message', 'The exact wording, and whether it happened on the first request of the session or a later one.'],
  ['A security issue', 'Email it privately and give it a day before sharing it anywhere public.'],
  ['An idea', 'What you were trying to do, more than the feature you had in mind — the underlying task is the useful part.'],
];

/**
 * PLACEHOLDER LINKS. Every href here is "#" until the real profile URLs are
 * supplied. The previous page shipped these pointing at "/", and a dead link
 * on the one block a recruiter clicks is worse than no block at all.
 * `grep data-needs-url` finds every one.
 */
const PROFILES: Array<{ Icon: typeof IconGitHub; name: string; note: string; href: string }> = [
  { Icon: IconGitHub, name: 'GitHub', note: 'the source, and everything else I build', href: '#' },
  { Icon: IconLinkedIn, name: 'LinkedIn', note: 'background and work history', href: '#' },
  { Icon: IconDiscord, name: 'Discord', note: 'questions about the project', href: '#' },
  { Icon: IconPortfolio, name: 'Portfolio', note: 'other work, in more detail', href: '#' },
];

type FieldKey = 'name' | 'email' | 'topic' | 'message';
type FieldErrors = Partial<Record<FieldKey, string>>;
interface Values { name: string; email: string; topic: string; message: string }

/**
 * Pure, so the submit path and any future on-blur path cannot drift. The form
 * carries `noValidate` for the same reason the auth form does: the browser's
 * native bubbles would otherwise disagree with these messages about the same
 * field.
 */
function validate(v: Values): FieldErrors {
  const e: FieldErrors = {};
  if (!v.name.trim()) e.name = 'Tell us who you are.';
  if (!v.email.trim()) e.email = 'We need somewhere to reply.';
  else if (!EMAIL_RE.test(v.email.trim())) e.email = 'That does not look like an email address.';
  if (!v.topic) e.topic = 'Pick the closest match.';
  if (!v.message.trim()) e.message = 'Say what happened.';
  else if (v.message.trim().length < 12) e.message = 'A little more detail will get a better answer.';
  return e;
}

const LABEL =
  'font-code-sm text-[10px] font-medium leading-[1.62] tracking-[0.12em] uppercase text-[color:var(--ink-faint)]';

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-[7px]">
      <label htmlFor={id} className={LABEL}>
        {label} <span className="text-secondary">*</span>
      </label>
      {children}
      {error && <span className="font-body-lg text-[12.5px] leading-[1.5] text-error">{error}</span>}
    </div>
  );
}

const fieldClass = (bad: boolean) =>
  `u-transition w-full rounded-[10px] border px-3.5 py-3 font-body-lg text-[14.5px] leading-[1.55] text-on-surface placeholder:text-[color:var(--ink-faint)] focus:outline-none focus:ring-4 ${
    bad
      ? 'border-error/50 bg-error/[0.07] focus:ring-error/15'
      : 'border-outline-variant bg-surface-container-low focus:border-secondary focus:bg-surface-container-lowest dark:focus:bg-card focus:ring-[color:var(--accent-wash)]'
  }`;

export default function ContactPage({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode,
}: ContactPageProps) {
  const [values, setValues] = useState<Values>({ name: '', email: '', topic: '', message: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, setState] = useState<'form' | 'sending' | 'sent' | 'failed'>('form');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [trap, setTrap] = useState('');

  const set = (k: FieldKey) => (value: string) => {
    setValues((p) => ({ ...p, [k]: value }));
    setErrors((p) => {
      if (!p[k]) return p;
      const next = { ...p };
      delete next[k];
      return next;
    });
  };

  const copyAddress = async () => {
    const addr = mailAddress();
    try {
      // navigator.clipboard is undefined outside a secure context — the same
      // LAN-over-HTTP case the workspace's copy action guards.
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(addr);
      else throw new Error('no clipboard');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = addr;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Honeypot filled means a bot. Show the ordinary success state and drop it —
    // an error would tell it which field tripped the trap.
    if (trap !== '') {
      setState('sent');
      return;
    }

    const found = validate(values);
    setErrors(found);
    const first = Object.keys(found)[0] as FieldKey | undefined;
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }

    setState('sending');
    // A rejected request goes to 'failed', never 'sent'. The previous version
    // fell through to the success state on error and lost the message.
    fetch('https://formsubmit.co/ajax/' + mailAddress(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: values.name.trim(),
        email: values.email.trim(),
        subject: values.topic,
        message: values.message.trim(),
        _subject: `Forma: ${values.topic} (from ${values.name.trim()})`,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`send failed: ${r.status}`);
        setState('sent');
      })
      .catch((err) => {
        console.error('Contact form send failed:', err);
        setState('failed');
      });
  };

  return (
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      <SheetRuler />
      <SiteHeader
        active="Contact"
        onEnterWorkspace={onEnterWorkspace}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        user={user}
        logOut={logOut}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />

      <main className="flex-grow sheet-grid py-[76px]">
        <div className="max-w-container-max mx-auto px-margin-desktop">
          <div className="flex items-center gap-3 font-code-sm text-[11px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-[color:var(--ink-faint)]">
            <b className="font-medium text-secondary">x 000 · y 0000</b>
            Contact
            <span className="h-px flex-1 bg-gradient-to-r from-outline-variant to-transparent" />
          </div>

          <div className="mt-7 grid items-start gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-16">
            {/* ------------------------------------------------ routing */}
            <div>
              <h1 className="font-display-lg text-[clamp(34px,5.2vw,52px)] font-extrabold leading-[1.04] tracking-[-0.038em] text-on-surface text-balance">
                Something not working, or not making sense?
              </h1>
              <p className="mt-4 max-w-[54ch] font-body-lg text-[clamp(16.5px,1.3vw,18.5px)] leading-[1.58] text-on-surface-variant">
                Forma is open source and looked after by one person, so messages come straight to a real inbox
                rather than a ticket queue. A short note with the right detail gets a much faster answer than a
                long one without it.
              </p>

              <h2 className="mt-9 font-code-sm text-[9.5px] font-medium leading-[1.62] tracking-[0.14em] uppercase text-secondary">
                What to include
              </h2>
              <div className="mt-2 border-t border-outline-variant">
                {ROUTES.map(([t, d]) => (
                  <div
                    key={t}
                    className="grid gap-y-1.5 border-b border-outline-variant py-[18px] sm:grid-cols-[172px_minmax(0,1fr)] sm:items-baseline sm:gap-x-5"
                  >
                    <div className="font-display-lg text-[15px] font-bold leading-[1.3] tracking-[-0.016em] text-on-surface">
                      {t}
                    </div>
                    <div className="font-body-lg text-[14px] leading-[1.58] text-on-surface-variant">{d}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* --------------------------------------------------- form */}
            <div>
              <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest dark:bg-card p-7 shadow-[var(--shadow-lg),var(--inset-hi)] sm:px-9 sm:py-8">
                <h2 className="font-display-lg text-[24px] font-extrabold leading-[1.2] tracking-[-0.028em] text-on-surface">
                  Send a message
                </h2>
                <p className="mt-2 font-body-lg text-[14.5px] leading-[1.6] text-on-surface-variant">
                  Everything marked with an asterisk is needed. Nothing else is collected.
                </p>

                {state === 'sent' ? (
                  <div className="mt-6 flex items-start gap-3 rounded-xl border border-success/35 bg-success/10 px-5 py-[18px]">
                    <IconCheck size={20} className="mt-0.5 shrink-0 text-success" />
                    <div>
                      <h3 className="font-display-lg text-[16px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                        Message sent
                      </h3>
                      <p className="mt-1.5 font-body-lg text-[14px] leading-[1.6] text-on-surface-variant">
                        It is on its way to the maintainer's inbox, and a reply will come to{' '}
                        {values.email.trim() || 'the address you gave'}. Usually a day or two.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setValues({ name: '', email: '', topic: '', message: '' });
                          setErrors({});
                          setState('form');
                        }}
                        className="u-transition u-press mt-3.5 cursor-pointer rounded-full border border-outline-variant bg-surface-container-lowest dark:bg-card px-4 py-2 font-body-lg text-[14px] font-semibold text-on-surface hover:border-[color:var(--ink-faint)]"
                      >
                        Send another
                      </button>
                    </div>
                  </div>
                ) : state === 'failed' ? (
                  <div className="mt-6 flex items-start gap-3 rounded-xl border border-error/40 bg-error/[0.08] px-5 py-[18px]">
                    <IconWarn size={20} className="mt-0.5 shrink-0 text-error" />
                    <div>
                      <h3 className="font-display-lg text-[16px] font-bold leading-[1.3] tracking-[-0.018em] text-on-surface">
                        That did not send
                      </h3>
                      <p className="mt-1.5 font-body-lg text-[14px] leading-[1.6] text-on-surface-variant">
                        The message did not get through, so it has not reached anyone. Your text is still in
                        the form — try again, or take the address from the panel below and send it by mail.
                      </p>
                      <button
                        type="button"
                        onClick={() => setState('form')}
                        className="u-transition u-press mt-3.5 cursor-pointer rounded-full border border-outline-variant bg-surface-container-lowest dark:bg-card px-4 py-2 font-body-lg text-[14px] font-semibold text-on-surface hover:border-[color:var(--ink-faint)]"
                      >
                        Back to the form
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} noValidate className="mt-6 grid gap-4">
                    {/* Honeypot: off-canvas rather than display:none, because some
                        bots skip fields that are not rendered at all. */}
                    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                      <label htmlFor="company">Company</label>
                      <input
                        id="company"
                        name="company"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={trap}
                        onChange={(e) => setTrap(e.target.value)}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field id="name" label="Name" error={errors.name}>
                        <input
                          id="name"
                          type="text"
                          autoComplete="name"
                          placeholder="Alex Riviera"
                          value={values.name}
                          onChange={(e) => set('name')(e.target.value)}
                          aria-invalid={!!errors.name}
                          className={fieldClass(!!errors.name)}
                        />
                      </Field>
                      <Field id="email" label="Email" error={errors.email}>
                        {/* example.com is reserved for documentation, so the
                            placeholder cannot be scraped as a live address. */}
                        <input
                          id="email"
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          value={values.email}
                          onChange={(e) => set('email')(e.target.value)}
                          aria-invalid={!!errors.email}
                          className={fieldClass(!!errors.email)}
                        />
                      </Field>
                    </div>

                    <Field id="topic" label="What is this about?" error={errors.topic}>
                      <div className="relative">
                        <select
                          id="topic"
                          value={values.topic}
                          onChange={(e) => set('topic')(e.target.value)}
                          aria-invalid={!!errors.topic}
                          className={`${fieldClass(!!errors.topic)} cursor-pointer appearance-none pr-10`}
                        >
                          <option value="">Choose one</option>
                          {TOPICS.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                        <IconChevronDown
                          size={16}
                          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[color:var(--ink-faint)]"
                        />
                      </div>
                    </Field>

                    <Field id="message" label="Message" error={errors.message}>
                      <textarea
                        id="message"
                        rows={5}
                        placeholder="What happened, and what you expected instead."
                        value={values.message}
                        onChange={(e) => set('message')(e.target.value)}
                        aria-invalid={!!errors.message}
                        className={`${fieldClass(!!errors.message)} min-h-[132px] resize-y`}
                      />
                    </Field>

                    <button
                      type="submit"
                      disabled={state === 'sending'}
                      aria-busy={state === 'sending'}
                      className="u-transition u-press u-focus-ring group inline-flex cursor-pointer items-center justify-center gap-[9px] rounded-full bg-secondary-container px-6 py-[13px] font-body-lg text-[14.5px] font-semibold text-white shadow-[0_1px_2px_rgba(8,24,43,0.1)] hover:bg-[color:var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {state === 'sending' ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          <span className="sr-only">Sending</span>
                        </>
                      ) : (
                        <>
                          Send message
                          <IconArrowRight size={15} className="u-transition group-hover:translate-x-[3px]" />
                        </>
                      )}
                    </button>

                    <p className="font-body-lg text-[12.5px] leading-[1.55] text-[color:var(--ink-faint)]">
                      Your message and address are used to reply to you and nothing else. No newsletter, no
                      analytics on this form.
                    </p>
                  </form>
                )}
              </div>

              {/* --------------------------------------- the address */}
              <div className="mt-7 rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-[22px] py-5 shadow-[var(--shadow-sm)]">
                <div className="flex items-start gap-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-[color:var(--accent-line)] bg-[color:var(--accent-wash)] text-secondary">
                    <IconMail size={17} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-code-sm text-[9.5px] font-medium leading-[1.62] tracking-[0.14em] uppercase text-[color:var(--ink-faint)]">
                      Or email directly
                    </div>
                    {revealed ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <a
                          href={`mailto:${revealed}`}
                          className="font-code-sm text-[13.5px] font-medium break-all text-on-surface border-b border-[color:var(--accent-line)] hover:border-secondary hover:text-secondary"
                        >
                          {revealed}
                        </a>
                        <button
                          type="button"
                          onClick={copyAddress}
                          className="u-transition cursor-pointer rounded-full border border-outline-variant px-2.5 py-0.5 font-code-sm text-[10px] tracking-[0.1em] uppercase text-[color:var(--ink-faint)] hover:border-secondary hover:text-secondary"
                        >
                          {copied ? 'copied' : 'copy'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevealed(mailAddress())}
                        className="u-transition u-press mt-1.5 inline-flex cursor-pointer items-center gap-2 rounded-full border border-outline-variant bg-surface-container-low px-3.5 py-1.5 font-body-lg text-[13px] font-semibold text-on-surface hover:border-secondary hover:bg-[color:var(--accent-wash)] hover:text-secondary"
                      >
                        <IconMail size={14} />
                        Reveal the address
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2.5 font-body-lg text-[13px] leading-[1.55] text-[color:var(--ink-faint)]">
                  Replies usually take a day or two. There is no on-call rota behind this — it is one person
                  and a mail client.
                </p>
              </div>
            </div>
          </div>

          {/* ------------------------------------------- behind the project */}
          <section className="mt-[88px] border-t border-outline-variant pt-11">
            <div className="flex items-center gap-3 font-code-sm text-[11px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-[color:var(--ink-faint)]">
              <b className="font-medium text-secondary">x 000 · y 0840</b>
              Behind the project
              <span className="h-px flex-1 bg-gradient-to-r from-outline-variant to-transparent" />
            </div>

            <div className="mt-7 grid items-start gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:gap-14">
              <div>
                <div className="flex items-center gap-4">
                  <Logo size={56} className="rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card p-2" alt="" />
                  <div>
                    <h2 className="font-display-lg text-[27px] font-extrabold leading-[1.1] tracking-[-0.03em] text-on-surface">
                      Waqar Sayyed
                    </h2>
                    <div className="mt-0.5 font-body-lg text-[14.5px] text-on-surface-variant">
                      Designed and built Forma, end to end.
                    </div>
                  </div>
                </div>
                <p className="mt-5 max-w-[54ch] font-body-lg text-[15.5px] leading-[1.66] text-on-surface-variant">
                  The interface, the prompt design, the DevExpress XML generation, the encryption around the
                  API key and the decision to keep generation out of the server — all of it is one person's
                  work, and the reasoning behind each choice is written down in the open.
                </p>
                <p className="mt-4 max-w-[54ch] font-body-lg text-[15.5px] leading-[1.66] text-on-surface-variant">
                  The application is the portfolio. Everything else is linked here.
                </p>
              </div>

              <div className="grid gap-2.5">
                {PROFILES.map((p) => (
                  <a
                    key={p.name}
                    href={p.href}
                    data-needs-url
                    className="u-transition group flex items-center gap-3.5 rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-[17px] py-[15px] shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:border-[color:var(--accent-line)] hover:shadow-[var(--shadow-md)]"
                  >
                    <span className="u-transition grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-surface-container-high text-on-surface group-hover:bg-[color:var(--accent-wash)] group-hover:text-secondary">
                      <p.Icon size={19} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-body-lg text-[14.5px] font-semibold tracking-[-0.012em] text-on-surface">
                        {p.name}
                      </span>
                      <span className="block font-code-sm text-[11px] leading-[1.45] text-[color:var(--ink-faint)]">
                        {p.note}
                      </span>
                    </span>
                    <IconExternal
                      size={15}
                      className="u-transition ml-auto shrink-0 text-[color:var(--ink-faint)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-secondary"
                    />
                  </a>
                ))}

                {/* Points at the form rather than carrying a mailto: one
                    plaintext address in the markup is all a harvester needs. */}
                <a
                  href="#top"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById('message')?.focus();
                  }}
                  className="u-transition group flex items-center gap-3.5 rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card px-[17px] py-[15px] shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:border-[color:var(--accent-line)] hover:shadow-[var(--shadow-md)]"
                >
                  <span className="u-transition grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-surface-container-high text-on-surface group-hover:bg-[color:var(--accent-wash)] group-hover:text-secondary">
                    <IconMail size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-body-lg text-[14.5px] font-semibold tracking-[-0.012em] text-on-surface">
                      Email
                    </span>
                    <span className="block font-code-sm text-[11px] leading-[1.45] text-[color:var(--ink-faint)]">
                      the form above, or reveal the address
                    </span>
                  </span>
                  <IconExternal
                    size={15}
                    className="u-transition ml-auto shrink-0 text-[color:var(--ink-faint)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-secondary"
                  />
                </a>
              </div>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
