import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { backdropVariants, transition } from '../lib/motion';
import { IconMenu, IconClose, IconGitHub } from './landing/icons';
import { useFocusTrap } from './useFocusTrap';

const LINKS = [
  { label: 'Product', path: '/' },
  { label: 'Features', path: '/features' },
  { label: 'Pricing', path: '/pricing' },
  { label: 'Docs', path: '/docs' },
  { label: 'Contact', path: '/contact' },
] as const;

const REPO_URL = 'https://github.com/waqarsyd/forma';

/**
 * Hamburger + slide-down sheet for the marketing headers.
 *
 * The desktop nav in these pages is `hidden lg:flex`, which previously left
 * phones with no navigation at all. This renders below lg, so it covers tablets
 * too — the desktop header used to appear at `md`, where the wordmark and the
 * first nav link ended up 5px apart and read as one phrase ("Forma Product").
 * The full header only fits from about 820px, so `lg` is where it belongs.
 *
 * It is a full-screen fixed sheet rather than a dropdown so it does not depend
 * on the surrounding header's positioning — the four headers differ slightly.
 *
 * A real modal since 2026-11-08 (the site audit's batch SF, item 41): it
 * covered the page and took the scroll, yet focus stayed behind it, Tab
 * walked out into the page underneath, and nothing told a screen reader it
 * was a dialog. Now `role="dialog"` with `aria-modal`, and `useFocusTrap`
 * takes focus in, keeps Tab inside, closes on Escape (through the layer
 * stack) and gives focus back to the menu button. The labels are in sentence
 * case like the header's ("Sign in", not "Sign In"; item 77).
 */
function MenuSheet({ active, signedIn, onClose }: { active?: string; signedIn?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);

  return (
    <motion.div
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      onClick={onClose}
      className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm"
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -16, opacity: 0 }}
        transition={transition.base}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest dark:bg-card border-b border-outline-variant shadow-2xl px-5 pt-4 pb-6 flex flex-col gap-1 focus:outline-none"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-label-caps text-[10px] tracking-widest text-on-surface-variant uppercase font-bold">
            Menu
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="u-tap u-transition-fast u-press u-focus-ring w-10 h-10 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container cursor-pointer"
          >
            <IconClose size={20} />
          </button>
        </div>

        <nav aria-label="Site" className="flex flex-col gap-1">
          {LINKS.map((link) => {
            const isActive = active === link.label;
            return (
              <a
                key={link.label}
                href={link.path}
                onClick={onClose}
                aria-current={isActive ? 'page' : undefined}
                className={`u-tap u-transition-fast u-focus-ring flex items-center rounded-xl px-4 py-3 font-title-md text-body-sm ${
                  isActive
                    ? 'bg-secondary/10 text-secondary font-bold'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-secondary'
                }`}
              >
                {link.label}
              </a>
            );
          })}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener"
            className="u-tap u-transition-fast u-focus-ring flex items-center gap-2.5 rounded-xl px-4 py-3 font-title-md text-body-sm text-on-surface-variant hover:bg-surface-container hover:text-secondary"
          >
            <IconGitHub size={16} />
            GitHub
          </a>
        </nav>

        {/* The header cannot hold the account controls at phone widths —
            nowrap alone pushed them off the right edge — so they live here
            instead. Signed in, that is Open the workspace; signed out, Sign
            in and Create account, the labels the header and the sign-in card
            use (2026-11-11, full audit PS-23: this said "Workspace" and "Sign
            up"). Sign out stays on the avatar menu, which is compact enough
            to remain in the header at every width. */}
        {signedIn && (
          <div className="mt-3 pt-3 border-t border-outline-variant/40 flex flex-col gap-2">
            <a
              href="/workspace"
              onClick={onClose}
              className="u-tap u-transition-fast u-focus-ring flex items-center justify-center rounded-full px-4 py-3 font-label-caps text-body-sm bg-secondary-container text-white shadow-lg shadow-secondary-container/20 hover:bg-[color:var(--accent-deep)]"
            >
              Open the workspace
            </a>
          </div>
        )}

        {!signedIn && (
          <div className="mt-3 pt-3 border-t border-outline-variant/40 flex flex-col gap-2">
            <a
              href="/login"
              onClick={onClose}
              className="u-tap u-transition-fast u-focus-ring flex items-center justify-center rounded-full px-4 py-3 font-label-caps text-body-sm border border-outline-variant text-on-surface-variant hover:text-secondary hover:border-secondary"
            >
              Sign in
            </a>
            <a
              href="/signup"
              onClick={onClose}
              className="u-tap u-transition-fast u-focus-ring flex items-center justify-center rounded-full px-4 py-3 font-label-caps text-body-sm bg-secondary-container text-white shadow-lg shadow-secondary-container/20 hover:bg-[color:var(--accent-deep)]"
            >
              Create account
            </a>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

export default function MobileNav({ active, signedIn }: { active?: string; signedIn?: boolean }) {
  const [open, setOpen] = useState(false);

  // Never leave the page scroll-locked behind the sheet. Escape and focus are
  // the sheet's own, through useFocusTrap.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="u-tap u-transition-fast u-press u-focus-ring w-10 h-10 flex items-center justify-center rounded-full border border-outline-variant text-on-surface-variant hover:text-secondary hover:border-secondary cursor-pointer"
      >
        <IconMenu size={20} />
      </button>

      <AnimatePresence>
        {open && <MenuSheet active={active} signedIn={signedIn} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
