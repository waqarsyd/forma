/**
 * The corner's help (2026-11-06), as Google Stitch's "?" at the bottom right:
 * the theme as Light, System or Dark, What's new (the changelog, since
 * 2026-11-08), the command menu and the keyboard shortcuts, the help pages
 * and a way to send feedback, and the line every AI product owes its reader.
 * The one place for each of those in the workspace since 2026-11-08, when
 * their repeats elsewhere went at the owner's request. Opens upward from its button; Escape or a click elsewhere closes
 * it. The help pages and the contact page open in a new tab, so the open
 * report stays where it is. See *The conversation floats over the report* in
 * docs/notes/app-shell.md.
 */
import { useEffect, useRef } from 'react';
import { IconExternal, IconMonitor, IconMoon, IconSun } from './landing/icons';
import { problemReportUrl } from '../lib/problemReport';
import { versionLabel } from '../lib/buildInfo';
import './overlays.css';
import { useLayer } from './useLayer';
import { useReturnFocus } from './useMenuKeys';

export type ThemeChoice = 'light' | 'system' | 'dark';

interface Props {
  theme: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
  onShortcuts: () => void;
  /** The command menu (Ctrl+K), opened from here since 2026-11-08. */
  onCommandMenu?: () => void;
  /** Its keys as this platform writes them, "Ctrl+K" or "⌘K". */
  commandKeys?: string;
  onClose: () => void;
}

/*
 * Help that reaches a person (2026-11-11, the full audit's SA-15b and SA-28b).
 * A problem could be reported only from a crash, through the error boundary,
 * so a save that failed or a reply that never came reached nobody; and a
 * person could not tell whether Forma, Gemini or the database was down.
 * "Report a problem" opens the same prefilled GitHub form the error boundary
 * does (lib/problemReport.ts), with the build, the page and the browser and
 * nothing of the report; Send feedback, the contact page, is the way without
 * a GitHub account. The status rows are Forma's own live checks
 * (.github/workflows/live.yml) and Google's pages for Gemini and Firebase.
 */
export const LIVE_CHECKS_URL = 'https://github.com/waqarsyd/forma/actions/workflows/live.yml';
export const GEMINI_STATUS_URL = 'https://aistudio.google.com/status';
export const FIREBASE_STATUS_URL = 'https://status.firebase.google.com/';

/** The prefilled issue for a problem someone met without a crash. */
export function helpProblemUrl(): string {
  return problemReportUrl({
    area: 'the workspace',
    message: 'something did not work as it should',
    version: versionLabel(),
    path: typeof location === 'undefined' ? undefined : location.pathname,
    browser: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  });
}

const THEMES: [ThemeChoice, string, typeof IconSun][] = [
  ['light', 'Light', IconSun],
  ['system', 'System', IconMonitor],
  ['dark', 'Dark', IconMoon],
];

export default function HelpMenu({ theme, onTheme, onShortcuts, onCommandMenu, commandKeys = 'Ctrl+K', onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      // The "?" that opened it toggles it itself.
      if (!box.current?.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('[data-help-toggle]')) onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  useLayer(onClose, true, 'help');
  // Focus back to "?" when it closes (2026-11-06).
  useReturnFocus(box);
  /* A radio group's arrows (2026-11-06, the workspace audit): ← and → (or ↑
     and ↓) choose the next theme and move to it, and only the chosen one is in
     the Tab order, as a group of radios is. */
  const at = THEMES.findIndex(([value]) => value === theme);
  const step = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const next = (at + by + THEMES.length) % THEMES.length;
    onTheme(THEMES[next][0]);
    (e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next])?.focus();
  };
  return (
    <div className="wb-help" ref={box} role="dialog" aria-label="Help">
      <div className="wb-help-theme" role="radiogroup" aria-label="Theme" onKeyDown={step}>
        {THEMES.map(([value, label, Icon]) => (
          <button key={value} type="button" role="radio" aria-checked={theme === value} tabIndex={theme === value ? 0 : -1} onClick={() => onTheme(value)}>
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {/* What's new is the changelog, every release (2026-11-08): it was two
          rows, the dock's announcements unfolding here and the changelog
          beside them, the same news twice, and the owner asked for repeats to
          go. Settings' version line linked it a third time. */}
      <a className="wb-help-row" href="/changelog" target="_blank" rel="noopener">
        <span>What's new</span>
        <IconExternal size={13} />
      </a>
      {/* The command menu here, beside the shortcuts (2026-11-08): its row was
          the main menu's, which went back to being the project's menu. */}
      {onCommandMenu && (
        <button type="button" className="wb-help-row" onClick={() => { onClose(); onCommandMenu(); }}>
          <span>Command menu</span>
          <kbd>{commandKeys}</kbd>
        </button>
      )}
      <button type="button" className="wb-help-row" onClick={() => { onClose(); onShortcuts(); }}>
        <span>Keyboard shortcuts</span>
        <kbd>?</kbd>
      </button>
      {/* Docs, the FAQ, the community and the privacy notice (2026-11-08), as
          Stitch's "?" lists Docs, FAQ, Forum and Privacy Notice; Forma's
          forum is its GitHub Discussions. */}
      <a className="wb-help-row" href="/docs" target="_blank" rel="noopener">
        <span>Docs</span>
        <IconExternal size={13} />
      </a>
      <a className="wb-help-row" href="/faq" target="_blank" rel="noopener">
        <span>FAQ</span>
        <IconExternal size={13} />
      </a>
      <a className="wb-help-row" href="https://github.com/waqarsyd/forma/discussions" target="_blank" rel="noopener">
        <span>Discussions</span>
        <IconExternal size={13} />
      </a>
      <a className="wb-help-row" href="/privacy" target="_blank" rel="noopener">
        <span>Privacy</span>
        <IconExternal size={13} />
      </a>
      <a
        className="wb-help-row"
        href={helpProblemUrl()}
        target="_blank"
        rel="noopener noreferrer"
        title="On GitHub, with the version and the page filled in. Without a GitHub account, use Send feedback."
      >
        <span>Report a problem</span>
        <IconExternal size={13} />
      </a>
      <a className="wb-help-row" href="/contact" target="_blank" rel="noopener">
        <span>Send feedback</span>
        <IconExternal size={13} />
      </a>
      <a className="wb-help-row" href={LIVE_CHECKS_URL} target="_blank" rel="noopener noreferrer" title="Forma's own checks of the live site, every few hours">
        <span>Service status</span>
        <IconExternal size={13} />
      </a>
      <a className="wb-help-row" href={GEMINI_STATUS_URL} target="_blank" rel="noopener noreferrer">
        <span>Gemini status</span>
        <IconExternal size={13} />
      </a>
      <a className="wb-help-row" href={FIREBASE_STATUS_URL} target="_blank" rel="noopener noreferrer" title="Google's page for sign-in and saved projects">
        <span>Sign-in and saving status</span>
        <IconExternal size={13} />
      </a>
      <p className="wb-help-note">Forma can make mistakes. Open a report in the DevExpress designer before you rely on it.</p>
    </div>
  );
}
