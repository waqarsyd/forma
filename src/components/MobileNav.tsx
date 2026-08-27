import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { backdropVariants, transition } from '../lib/motion';
import { IconMenu, IconClose } from './landing/icons';

const LINKS = [
  { label: 'Product', path: '/' },
  { label: 'Features', path: '/features' },
  { label: 'Docs', path: '/docs' },
  { label: 'Contact', path: '/contact' },
] as const;

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
 */
export default function MobileNav({ active, signedIn }: { active?: string; signedIn?: boolean }) {
  const [open, setOpen] = useState(false);

  // Close on Escape, and never leave the page scroll-locked behind the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="u-tap u-transition-fast u-press u-focus-ring w-10 h-10 flex items-center justify-center rounded-full border border-outline-variant text-on-surface-variant hover:text-secondary hover:border-secondary cursor-pointer"
      >
        <IconMenu size={20} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm"
          >
            <motion.nav
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={transition.base}
              onClick={(e) => e.stopPropagation()}
              aria-label="Site"
              className="bg-surface-container-lowest dark:bg-card border-b border-outline-variant shadow-2xl px-5 pt-4 pb-6 flex flex-col gap-1"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-label-caps text-[10px] tracking-widest text-on-surface-variant uppercase font-bold">
                  Menu
                </span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="u-tap u-transition-fast u-press u-focus-ring w-10 h-10 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container cursor-pointer"
                >
                  <IconClose size={20} />
                </button>
              </div>

              {LINKS.map((link) => {
                const isActive = active === link.label;
                return (
                  <a
                    key={link.label}
                    href={link.path}
                    onClick={() => setOpen(false)}
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

              {/* The header cannot hold the account controls at phone widths —
                  nowrap alone pushed them off the right edge — so they live here
                  instead. Signed in, that is Workspace; signed out, Sign In/Up.
                  Sign Out stays on the avatar menu, which is compact enough to
                  remain in the header at every width. */}
              {signedIn && (
                <div className="mt-3 pt-3 border-t border-outline-variant/40 flex flex-col gap-2">
                  <a
                    href="/workspace"
                    onClick={() => setOpen(false)}
                    className="u-tap u-transition-fast u-focus-ring flex items-center justify-center rounded-full px-4 py-3 font-label-caps text-body-sm bg-secondary-container text-white shadow-lg shadow-secondary-container/20 hover:bg-secondary"
                  >
                    Workspace
                  </a>
                </div>
              )}

              {!signedIn && (
                <div className="mt-3 pt-3 border-t border-outline-variant/40 flex flex-col gap-2">
                  <a
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="u-tap u-transition-fast u-focus-ring flex items-center justify-center rounded-full px-4 py-3 font-label-caps text-body-sm border border-outline-variant text-on-surface-variant hover:text-secondary hover:border-secondary"
                  >
                    Sign In
                  </a>
                  <a
                    href="/signup"
                    onClick={() => setOpen(false)}
                    className="u-tap u-transition-fast u-focus-ring flex items-center justify-center rounded-full px-4 py-3 font-label-caps text-body-sm bg-secondary-container text-white shadow-lg shadow-secondary-container/20 hover:bg-secondary"
                  >
                    Sign Up
                  </a>
                </div>
              )}
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
