/**
 * The corner's help (2026-11-06), as Google Stitch's "?" at the bottom right:
 * the theme as Light, System or Dark, What's new (the notes the landing page's
 * dock shows, from lib/announcements.ts), the keyboard shortcuts, the help
 * pages and a way to send feedback, and the line every AI product owes its
 * reader. Opens upward from its button; Escape or a click elsewhere closes
 * it. The help pages and the contact page open in a new tab, so the open
 * report stays where it is. See *The conversation floats over the report* in
 * docs/notes/app-shell.md.
 */
import { useEffect, useRef, useState } from 'react';
import { ANNOUNCEMENTS } from '../lib/announcements';
import { IconChevronDown, IconExternal, IconMonitor, IconMoon, IconSun } from './landing/icons';
import './overlays.css';
import { useLayer } from './useLayer';
import { useReturnFocus } from './useMenuKeys';

export type ThemeChoice = 'light' | 'system' | 'dark';

interface Props {
  theme: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
  onShortcuts: () => void;
  onClose: () => void;
}

const THEMES: [ThemeChoice, string, typeof IconSun][] = [
  ['light', 'Light', IconSun],
  ['system', 'System', IconMonitor],
  ['dark', 'Dark', IconMoon],
];

export default function HelpMenu({ theme, onTheme, onShortcuts, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [news, setNews] = useState(false);
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
      <button type="button" className="wb-help-row" aria-expanded={news} onClick={() => setNews((open) => !open)}>
        <span>What's new</span>
        <IconChevronDown size={14} />
      </button>
      {news && (
        <ul className="wb-help-news">
          {ANNOUNCEMENTS.map((a) => (
            <li key={a.id}>
              <b>{a.title}</b> <time dateTime={a.date}>{a.date}</time>
              <p>{a.body}</p>
            </li>
          ))}
        </ul>
      )}
      {/* Every release, not only the ones announced here (2026-11-07). */}
      <a className="wb-help-row" href="/changelog" target="_blank" rel="noopener">
        <span>Changelog</span>
        <IconExternal size={13} />
      </a>
      <button type="button" className="wb-help-row" onClick={() => { onClose(); onShortcuts(); }}>
        <span>Keyboard shortcuts</span>
        <kbd>?</kbd>
      </button>
      <a className="wb-help-row" href="/docs" target="_blank" rel="noopener">
        <span>Help</span>
        <IconExternal size={13} />
      </a>
      <a className="wb-help-row" href="/contact" target="_blank" rel="noopener">
        <span>Send feedback</span>
        <IconExternal size={13} />
      </a>
      <p className="wb-help-note">Forma can make mistakes. Open a report in the DevExpress designer before you rely on it.</p>
    </div>
  );
}
