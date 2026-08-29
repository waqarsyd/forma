import type { Transition, Variants } from 'motion/react';

/**
 * Shared motion vocabulary.
 *
 * These MIRROR the CSS tokens in src/index.css (--duration-*, --ease-*).
 * If you change a value here, change it there too — CSS drives the
 * micro-interactions, this file drives enter/exit and orchestration.
 *
 * Rule of thumb for this codebase:
 *   hover / press / focus / colour  -> CSS helper classes (.u-transition, .u-press)
 *   mount / unmount / reorder / tabs -> Framer Motion using the presets below
 */

/** Seconds — Framer Motion's unit. CSS equivalents are in milliseconds. */
export const DURATION = {
  fast: 0.15,
  base: 0.22,
  slow: 0.3,
  /** Long enough for an overshoot to read as a snap. Matches --duration-snap. */
  snap: 0.46,
} as const;

export const EASE = {
  /** Enter and general-purpose. Matches --ease-standard. */
  standard: [0.22, 1, 0.36, 1],
  /** Leave. Matches --ease-exit. */
  exit: [0.4, 0, 1, 1],
  /** Playful overshoot. Matches --ease-spring, which had no counterpart here. */
  spring: [0.34, 1.56, 0.64, 1],
} as const;

export const transition: Record<'fast' | 'base' | 'slow' | 'exit' | 'snap', Transition> = {
  fast: { duration: DURATION.fast, ease: EASE.standard },
  base: { duration: DURATION.base, ease: EASE.standard },
  slow: { duration: DURATION.slow, ease: EASE.standard },
  exit: { duration: DURATION.fast, ease: EASE.exit },
  snap: { duration: DURATION.snap, ease: EASE.spring },
};

/** Dimmed backdrop behind modals and drawers. */
export const backdropVariants: Variants = {
  hidden: { opacity: 0, transition: transition.exit },
  visible: { opacity: 1, transition: transition.fast },
};

/** Centred dialog panel. Pairs with backdropVariants. */
export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8, transition: transition.exit },
  visible: { opacity: 1, scale: 1, y: 0, transition: transition.base },
};

/* `drawerVariants`, `messageVariants`, `tabPanelVariants` and `snapInVariants`
   lived here until 2026-08-28. Nothing imported any of them, and two were
   measurably absent from the built bundle, so they were quarantined rather than
   kept as a vocabulary for screens that do not exist. They are recoverable from
   _not_required/MANIFEST.md if a drawer, an animated message list or an animated
   tab panel is ever built. */

/** Generic section reveal. */
export const fadeInUpVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: transition.slow },
};

/** Staggered container for lists that reveal together. */
export const staggerContainer = (stagger = 0.05): Variants => ({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: stagger, delayChildren: 0 },
  },
});

/**
 * Collapses any variants object to a no-op when the user prefers reduced
 * motion: elements still mount, they just arrive at their final state.
 * The CSS media query in index.css covers everything else.
 */
export const respectReducedMotion = (
  variants: Variants,
  prefersReduced: boolean | null,
): Variants =>
  prefersReduced
    ? {
        hidden: { opacity: 1 },
        visible: { opacity: 1, transition: { duration: 0 } },
      }
    : variants;
