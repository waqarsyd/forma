import { motion, useReducedMotion } from 'motion/react';
import { transition } from '../../lib/motion';

/**
 * The three workflow figures. Each states something the paragraph beside it
 * does not — what you can hand over, what the progress bar is counting, and
 * what comes back — rather than being decorative shapes.
 *
 * Drawn rather than screenshotted on purpose: the workspace UI is still moving,
 * and a screenshot would go stale the moment it changes.
 */

const FRAME =
  'relative mt-auto h-28 overflow-hidden rounded-[10px] border border-outline-variant bg-surface-container-lowest dark:bg-card shadow-[var(--shadow-sm)]';
const CAPTION =
  'absolute inset-x-0 bottom-[9px] text-center font-code-sm text-[8.5px] leading-[1.62] tracking-[0.09em] text-[color:var(--ink-faint)]';
/** The paper the two documents are drawn on — outlined in the stronger rule. */
const SHEET = 'rounded border border-outline bg-paper shadow-[0_3px_9px_rgba(8,24,43,0.10)]';

const view = { once: true, amount: 0.4 } as const;

/** What you can hand it. */
export function FigureIngest() {
  const reduce = useReducedMotion();
  const files = [
    { k: 'PNG', left: '22%', rotate: -8, delay: 0.05 },
    { k: 'PDF', left: '40%', rotate: 2, delay: 0.18 },
    { k: 'REPX', left: '58%', rotate: 10, delay: 0.31 },
  ];

  return (
    <div className={FRAME}>
      {files.map((f) => (
        // The tilt is a pose, not motion — it belongs on a static wrapper so
        // reduced motion drops the fall-in without also squaring up the stack.
        <div key={f.k} className="absolute top-4" style={{ left: f.left, transform: `rotate(${f.rotate}deg)` }}>
          <motion.div
            className={`relative h-[54px] w-[42px] ${SHEET}`}
            initial={{ opacity: 0, y: -26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={view}
            transition={{ ...transition.snap, delay: reduce ? 0 : f.delay }}
          >
            <span className="absolute inset-x-[7px] top-2 h-0.5 bg-outline-variant shadow-[0_5px_0_var(--color-outline-variant),0_10px_0_var(--color-outline-variant)]" />
            <span className="absolute inset-x-0 bottom-1.5 text-center font-code-sm text-[6.5px] leading-[1.62] font-medium tracking-[0.04em] text-secondary">
              {f.k}
            </span>
          </motion.div>
        </div>
      ))}
      <motion.span
        className={CAPTION}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={view}
        transition={{ ...transition.slow, delay: reduce ? 0 : 0.55 }}
      >
        3 files staged
      </motion.span>
    </div>
  );
}

/** What the bar is actually measuring. */
export function FigureStream() {
  const reduce = useReducedMotion();
  return (
    <div className={`${FRAME} flex flex-col justify-center gap-2.5 px-[22px] pb-6`}>
      <div className="flex items-center gap-[11px]">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--ground-2)]">
          <motion.span
            className="block h-full rounded-full bg-secondary-container"
            initial={{ width: '4%' }}
            whileInView={{ width: '62%' }}
            viewport={view}
            transition={{ ...transition.slow, duration: reduce ? 0 : 1.3, delay: reduce ? 0 : 0.2 }}
          />
        </span>
        <span className="min-w-[26px] text-right font-code-sm text-[10px] leading-[1.62] font-medium tabular-nums text-secondary">
          62%
        </span>
      </div>
      {[78, 54].map((w, i) => (
        <motion.span
          key={w}
          className="block h-[5px] origin-left rounded-full bg-[color:var(--ground-2)]"
          style={{ width: `${w}%` }}
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={view}
          transition={{ ...transition.slow, delay: reduce ? 0 : 0.55 + i * 0.17 }}
        />
      ))}
      <motion.span
        className={CAPTION}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={view}
        transition={{ ...transition.slow, delay: reduce ? 0 : 0.55 }}
      >
        chars received · 18.4s elapsed
      </motion.span>
    </div>
  );
}

/** What comes back. */
export function FigureExport() {
  const reduce = useReducedMotion();
  const lines = [
    { top: 10, right: 20, accent: true },
    { top: 18, right: 7, accent: false },
    { top: 26, right: 16, accent: false },
    { top: 34, right: 7, accent: false },
  ];

  return (
    <div className={`${FRAME} grid place-items-center pb-4`}>
      <motion.div
        className={`relative h-[58px] w-[46px] ${SHEET}`}
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={view}
        transition={{ ...transition.snap, delay: reduce ? 0 : 0.1 }}
      >
        {lines.map((l, i) => (
          <motion.span
            key={l.top}
            className={`absolute left-[7px] h-0.5 origin-left ${l.accent ? 'bg-secondary-container' : 'bg-outline-variant'}`}
            style={{ top: l.top, right: l.right }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={view}
            transition={{ ...transition.slow, delay: reduce ? 0 : 0.35 + i * 0.12 }}
          />
        ))}
        <motion.span
          className="absolute -bottom-2 -right-2 grid h-[19px] w-[19px] place-items-center rounded-full bg-success text-[11px] leading-none text-white ring-[3px] ring-surface-container-lowest dark:ring-card"
          initial={{ opacity: 0, scale: 0.4 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={view}
          transition={{ ...transition.snap, delay: reduce ? 0 : 0.88 }}
          aria-hidden="true"
        >
          ✓
        </motion.span>
      </motion.div>
      <motion.span
        className={CAPTION}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={view}
        transition={{ ...transition.slow, delay: reduce ? 0 : 0.55 }}
      >
        Invoice_2026_0431.repx
      </motion.span>
    </div>
  );
}
