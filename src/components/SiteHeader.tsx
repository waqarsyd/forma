import { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import Logo from './Logo';
import UserAvatar from './UserAvatar';
import MobileNav from './MobileNav';
import { IconSun, IconMoon, IconChevronDown, IconLogout } from './landing/icons';

/**
 * The header shared by all four marketing pages.
 *
 * It exists because the same markup was pasted into LandingPage, FeaturesPage,
 * DocsPage and ContactPage, and every fix had to be applied four times — which
 * is exactly how they drifted apart: the home page was rebuilt against the
 * approved design and the other three kept a 16px-taller bar, a different
 * accent and no backdrop blur. One copy, four callers, no drift.
 *
 * The tagline is hidden below lg and the auth controls move into MobileNav
 * below lg, because at phone widths the full set does not fit and used to
 * overlap.
 */

/**
 * `'none'` is for pages that are not in the nav at all — Terms and Privacy.
 * Passing one of the four instead would light a link the reader is not on.
 */
export type NavItem = 'Product' | 'Features' | 'Docs' | 'Contact' | 'none';

const LINKS: Array<{ label: NavItem; href: string }> = [
  { label: 'Product', href: '/' },
  { label: 'Features', href: '/features' },
  { label: 'Docs', href: '/docs' },
  { label: 'Contact', href: '/contact' },
];

const LINK_BASE = 'u-transition rounded-lg px-[13px] py-[7px] font-body-lg text-[14px] leading-[1.62]';

export default function SiteHeader({
  active,
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode,
}: {
  active: NavItem;
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    // Escape closes it too. A menu that can only be dismissed by clicking
    // elsewhere is a trap for the keyboard user who just opened it — and
    // MobileNav already does this, so the app was inconsistent with itself.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowProfileMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <header className="w-full sticky top-0 z-50 bg-surface/[0.84] [backdrop-filter:blur(16px)_saturate(1.5)] border-b border-outline-variant">
      <nav className="flex h-[68px] gap-6 justify-between items-center px-margin-desktop max-w-container-max mx-auto">
        <a href="/" className="flex items-center gap-[11px] select-none">
          <Logo size={30} />
          <span className="flex flex-col">
            <span className="font-display-lg text-[20px] leading-[1.05] font-extrabold tracking-[-0.03em] text-on-surface">
              Forma
            </span>
            <span className="mt-px font-code-sm text-[8.5px] leading-[1.62] font-medium tracking-[0.2em] text-[color:var(--ink-faint)] uppercase hidden lg:block">
              Show it &#183; Build it &#183; Ship it
            </span>
          </span>
        </a>

        <div className="hidden lg:flex items-center gap-1">
          {LINKS.map(({ label, href }) =>
            label === active ? (
              // The current page keeps its rule permanently; the others grow
              // one on hover, which is the only difference between them.
              <a
                key={label}
                href={href}
                aria-current="page"
                className={`${LINK_BASE} relative font-semibold text-on-surface after:absolute after:inset-x-[13px] after:bottom-[3px] after:h-[1.5px] after:bg-secondary`}
              >
                {label}
              </a>
            ) : (
              <a
                key={label}
                href={href}
                className={`${LINK_BASE} font-medium text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface`}
              >
                {label}
              </a>
            ),
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <MobileNav active={active} signedIn={!!user} />
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="u-transition u-press u-focus-ring w-[37px] h-[37px] grid place-items-center rounded-full border border-outline-variant bg-surface-container-lowest/60 hover:border-secondary text-on-surface-variant hover:text-secondary cursor-pointer select-none"
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            /* `title` alone was the accessible name here until 2026-09-01, and it
               was the only icon-only button in the app relying on one: the
               announcements bell beside it, the mobile menu button, the sign-in
               dialog's toggle and the workspace rail's all carry `aria-label`.
               A title is a weak fallback — it never appears on touch, and it is
               the last thing the accessible-name algorithm reaches for. This
               button sits in the header of all five marketing pages, so it was
               the most-seen instance of the one inconsistency. */
            aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {/* The mark shows the theme you are in, not the one you would
                switch to — the source design's reading. */}
            {isDarkMode ? <IconMoon size={16} /> : <IconSun size={16} />}
          </button>

          {user ? (
            <div className="flex items-center gap-4 relative" ref={profileMenuRef}>
              {/* A <button>, not a <div>. This was the only interactive element
                  in the app that took no focus: Tab skipped straight past it, so
                  a keyboard or screen-reader user could not reach the account
                  dialog or sign out at all. The theme toggle nine lines above
                  was already a real button with the same focus ring, which is
                  what makes the omission a slip rather than a decision.
                  WCAG 2.2 AA, 2.1.1 Keyboard and 4.1.2 Name/Role/Value. */}
              <button
                type="button"
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                aria-expanded={showProfileMenu}
                aria-haspopup="menu"
                aria-label="Account menu"
                className="u-transition u-focus-ring flex items-center gap-2.5 px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/30 rounded-full select-none cursor-pointer transition-colors"
              >
                <UserAvatar user={user} />
                <span className="font-label-caps text-[11px] text-on-surface-variant font-semibold hidden lg:inline max-w-[120px] truncate">
                  {user.displayName || user.email?.split('@')[0]}
                </span>
                {/* One chevron, rotated, rather than two glyphs. The button
                    already carries aria-expanded, so this says nothing a screen
                    reader needs — hence aria-hidden on the icon itself. */}
                <span className="hidden lg:inline text-on-surface-variant">
                  <IconChevronDown
                    size={16}
                    className={`u-transition ${showProfileMenu ? 'rotate-180' : ''}`}
                  />
                </span>
              </button>
              <button
                onClick={onEnterWorkspace}
                className="hidden lg:inline-block whitespace-nowrap font-label-caps text-on-surface-variant text-body-sm px-4 py-2 hover:text-secondary hover:bg-surface-container-low rounded-full transition-all active:scale-95 cursor-pointer"
              >
                Workspace
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-surface-container-lowest dark:bg-card border border-outline-variant rounded-2xl shadow-2xl z-50 overflow-hidden py-2">
                  <div className="px-4 py-3 border-b border-outline-variant/30 flex flex-col text-left">
                    <span className="text-xs font-bold text-on-surface truncate">
                      {user.displayName || 'Developer User'}
                    </span>
                    <span className="text-[10px] text-on-surface-variant truncate font-mono mt-0.5">
                      {user.email || 'developer@example.com'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      logOut();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-error-container text-error hover:text-error transition-colors text-left text-xs font-semibold font-label-caps cursor-pointer"
                  >
                    <IconLogout size={16} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="hidden lg:flex items-center gap-2.5">
              <button
                onClick={onSignIn}
                className="u-transition u-press u-focus-ring whitespace-nowrap rounded-full border border-transparent px-[18px] py-[10px] font-body-lg text-[14px] leading-[1.62] tracking-[-0.005em] font-semibold text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface cursor-pointer"
              >
                Sign in
              </button>
              <button
                onClick={onSignUp}
                className="u-transition u-press u-focus-ring whitespace-nowrap rounded-full border border-transparent bg-secondary-container px-[18px] py-[10px] font-body-lg text-[14px] leading-[1.62] tracking-[-0.005em] font-semibold text-white shadow-[0_1px_2px_rgba(8,24,43,0.1)] hover:bg-[color:var(--accent-deep)] cursor-pointer"
              >
                Sign up
              </button>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
