import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ANNOUNCEMENTS, SEEN_KEY, unseenCount } from '../../lib/announcements';
import { transition } from '../../lib/motion';
import { IconBell, IconClose } from './icons';

/**
 * A small round launcher in the bottom-right corner that opens the product's
 * notes. Modelled on the pattern Dribbble uses for its own corner launcher — a
 * ~44px disc, tucked into the corner, quiet until it has something to say.
 *
 * Three things are deliberate:
 *
 * 1. **Landing page only.** It is a first-visit surface. The workspace already
 *    has a rail, a review column and a status bar; adding a floating disc over
 *    a tool someone is working in is one thing too many, and the marketing
 *    pages other than `/` are reference material people arrive at on purpose.
 * 2. **Right, and the right has nothing else in it.** It briefly sat bottom-left
 *    and had to dodge `SheetRuler` (`fixed left-0 w-11` from `xl` up) with an
 *    `xl:left-16` offset. On this side there is no such obstacle, and it matches
 *    the corner the reference uses. The panel anchors `right-0` for the same
 *    reason: opening leftwards is the only direction with room.
 * 3. **Opening is what marks the notes read**, not a dismiss button. The dot
 *    exists to get the panel opened once; keeping it alive after that is how
 *    badges get ignored.
 */

const readSeenId = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    /* storage disabled — every visit is a first visit, which is the safe way
       round: the dock still opens and still reads. */
    return null;
  }
};

export default function AnnouncementDock() {
  const [open, setOpen] = useState(false);
  const [seenId, setSeenId] = useState<string | null>(readSeenId);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const unseen = unseenCount(ANNOUNCEMENTS, seenId);
  const newest = ANNOUNCEMENTS[0];

  const openDock = () => {
    setOpen(true);
    if (!newest || seenId === newest.id) return;
    setSeenId(newest.id);
    try {
      localStorage.setItem(SEEN_KEY, newest.id);
    } catch {
      /* storage disabled — the dot returns next visit, which is a small cost
         next to not opening at all */
    }
  };

  // Escape closes and hands focus back; a click outside closes and does not,
  // because the pointer is already where the reader wants to be.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  if (ANNOUNCEMENTS.length === 0) return null;

  const label = unseen > 0 ? `Announcements, ${unseen} unread` : 'Announcements';

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-label="Announcements"
            className="absolute bottom-[58px] right-0 w-[min(320px,calc(100vw-40px))] overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-lg)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={transition.base}
          >
            <div className="flex items-center justify-between gap-3 border-b border-outline-variant px-[18px] py-3">
              <span className="font-code-sm text-[9.5px] font-medium leading-[1.62] tracking-[0.15em] uppercase text-[color:var(--ink-faint)]">
                Announcements
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                aria-label="Close announcements"
                className="u-transition-fast u-press u-focus-ring grid h-6 w-6 place-items-center rounded-full text-[color:var(--ink-faint)] hover:bg-surface-container-low hover:text-on-surface cursor-pointer"
              >
                <IconClose size={13} />
              </button>
            </div>

            <div className="max-h-[46vh] overflow-y-auto">
              {ANNOUNCEMENTS.map((note, i) => (
                <article
                  key={note.id}
                  className={`px-[18px] py-[15px] ${i > 0 ? 'border-t border-outline-variant' : ''}`}
                >
                  {/* The date sits on the title line but is styled as body
                      text, not as heading text: body size, body colour, and
                      `font-normal` to override the `font-semibold` it would
                      otherwise inherit from the h3. That override is the whole
                      point — matching the heading's weight made the date read
                      as part of the title rather than as metadata attached to
                      it. The middle dot separates them for the same reason: a
                      hyphen reads as a sentence continuing.

                      `date` is also the sort key the newest-first order and its
                      test depend on, which is why it stays a plain ISO string —
                      it is shown exactly as stored, so a prettier format here
                      would mean formatting at render or breaking the sort. */}
                  <h3 className="font-body-lg text-[14px] font-semibold leading-[1.35] text-on-surface">
                    {note.title}
                    <span className="ml-1.5 text-[13px] font-normal leading-[1.55] text-on-surface-variant">
                      · {note.date}
                    </span>
                  </h3>
                  <p className="mt-1.5 font-body-lg text-[13px] leading-[1.55] text-on-surface-variant">
                    {note.body}
                  </p>
                </article>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openDock())}
        className="u-transition u-press u-focus-ring relative grid h-11 w-11 place-items-center rounded-full border border-outline-variant bg-surface-container-lowest dark:bg-card text-on-surface-variant shadow-[var(--shadow-md)] hover:border-secondary hover:text-secondary cursor-pointer"
      >
        <IconBell size={18} />
        {unseen > 0 && (
          /* A dot, not a number: three notes is not a count anyone needs, and
             the accessible name already carries it for anyone who does. */
          <span
            aria-hidden="true"
            className="absolute right-[9px] top-[9px] h-[7px] w-[7px] rounded-full bg-secondary ring-2 ring-[color:var(--surface-container-lowest)] dark:ring-[color:var(--card)]"
          />
        )}
      </button>
    </div>
  );
}
