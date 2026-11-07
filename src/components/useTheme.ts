import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { circularThemeSwap } from '../lib/themeTransition';
import { DURATION } from '../lib/motion';

/**
 * The theme, for the workspace (App.tsx) and the public site (PublicSite.tsx).
 * Moved out of App.tsx on 2026-11-08 (the site audit's batch SG, item 42),
 * when the public pages stopped loading App to draw themselves: two copies of
 * this would drift, as the sign-in dialog's copy once did (it set the state
 * without persisting, so a choice made there reverted on the next load).
 *
 * - The first value is the stored choice, else the system's; reading storage
 *   is guarded (2026-11-06, the workspace audit), since a profile that blocks
 *   it made the whole app throw on its first render.
 * - The effect syncs the class only. Persistence lives in `setTheme`, the
 *   user's action: StrictMode double-invokes effects in development, so an
 *   effect that wrote would persist the system's value on mount and detach
 *   the user from prefers-color-scheme for good.
 * - Mount does not animate: the inline script in index.html already painted
 *   the right theme. A genuine change cross-fades with the app's timing,
 *   unless a circular wipe already handled it (painting the fade inside the
 *   expanding circle turns its leading edge to mush).
 * - `setTheme` toggles the class inside the view transition rather than
 *   leaving it to the effect, since `startViewTransition` snapshots around its
 *   callback and a passive effect would land after the snapshot; `flushSync`
 *   keeps React's state in the same frame, which the toggle's own sun or moon
 *   renders from. `remember = false` is the corner's "System".
 * - While no choice is stored, the theme keeps following the system.
 */
export function useTheme() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('darkMode');
      if (saved !== null) return JSON.parse(saved) === true;
    } catch {
      /* storage blocked or unreadable: the system decides */
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const isFirstRun = useRef(true);
  const skipFade = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDarkMode);
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (skipFade.current) {
      skipFade.current = false;
      return;
    }
    root.classList.add('theme-transition');
    const timer = window.setTimeout(() => root.classList.remove('theme-transition'), DURATION.base * 1000);
    return () => window.clearTimeout(timer);
  }, [isDarkMode]);

  /** Whether no theme was ever chosen, so the OS decides (the corner's "System", 2026-11-06). */
  const [followsSystem, setFollowsSystem] = useState(() => {
    try {
      return localStorage.getItem('darkMode') === null;
    } catch {
      return true;
    }
  });

  const setTheme = useCallback((val: boolean, remember = true) => {
    // "System" when the system already agrees changes only what is remembered.
    if (document.documentElement.classList.contains('dark') !== val) {
      skipFade.current = circularThemeSwap(() => {
        document.documentElement.classList.toggle('dark', val);
        flushSync(() => setIsDarkMode(val));
      });
    }
    setFollowsSystem(!remember);
    try {
      if (remember) localStorage.setItem('darkMode', JSON.stringify(val));
      else localStorage.removeItem('darkMode');
    } catch {
      /* storage disabled — the choice still applies for this session */
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      let chosen: string | null = null;
      try {
        chosen = localStorage.getItem('darkMode');
      } catch {
        /* blocked: follow the system */
      }
      if (chosen === null) setIsDarkMode(e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return { isDarkMode, followsSystem, setTheme };
}
