import Logo from './Logo';

/**
 * The mark, working. Two concentric rings around the Forma logo: an outer
 * decorative orbit that turns, and an inner arc that is **the progress bar** —
 * the same `analyzingProgress` the old `.wb-track` drew, bent into a circle.
 *
 * The distinction matters more than it looks. The orbit is time-driven and
 * means nothing; the arc is data-driven and means exactly what it did before,
 * including that it caps at 95 until a parsed result arrives. Anything added
 * here has to fall on one side or the other, and a decoration must never be
 * shaped so it reads as a measurement.
 *
 * **Reduced motion is not a hypothetical here — it is the default on Windows
 * Server, which is what this is developed on.** `workspace.css` ends with a
 * blanket `.wb-root * { animation: none !important }`, so every keyframe in
 * this component is dead for a large share of users, and was dead for the
 * spinner this replaces. The design therefore does not depend on motion:
 *
 *  - the arc advances because output arrived, not because a keyframe looped, so
 *    it still moves under the preference — it snaps rather than eases, which is
 *    what the preference is asking for;
 *  - the orbit stops, and is decorative, so nothing is lost;
 *  - one low-amplitude opacity breathe is deliberately re-enabled in that block
 *    (see `.wb-halo-glow`) so the card is not a still image during a two-minute
 *    wait. It changes luminance only — no movement, no rotation, no scaling —
 *    which is the accommodation the preference actually asks for, and it is
 *    user-initiated work, the same exception the landing page's Replay button
 *    already makes.
 *
 * The logo is raster (no vector source — see `Logo.tsx`), which is why
 * everything animated here is drawn *around* the mark rather than out of it.
 */

/** Radius of the progress arc in viewBox units. */
const R = 41;
const CIRCUMFERENCE = 2 * Math.PI * R;

interface LogoPulseProps {
  /** 0–100. Clamped, so a caller cannot draw an arc past full. */
  percent: number;
  paused?: boolean;
  /** Rendered edge length in px. The whole thing is square. */
  size?: number;
}

export default function LogoPulse({ percent, paused = false, size = 76 }: LogoPulseProps) {
  const fraction = Math.max(0, Math.min(100, percent)) / 100;

  return (
    <span
      className={`wb-halo${paused ? ' wb-halo--paused' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="wb-halo-glow" />
      <svg className="wb-halo-svg" viewBox="0 0 100 100">
        {/* Decorative. Two short dashes on a wide radius, turning. */}
        <circle className="wb-halo-orbit" cx="50" cy="50" r="47" />
        <circle className="wb-halo-track" cx="50" cy="50" r={R} />
        {/* Real. `rotate(-90 50 50)` as an attribute rather than a CSS
            transform: it needs no transform-box, and it must not be something a
            reduced-motion rule can switch off. */}
        <circle
          className="wb-halo-arc"
          cx="50"
          cy="50"
          r={R}
          transform="rotate(-90 50 50)"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <Logo size={Math.round(size * 0.4)} className="wb-halo-mark" />
    </span>
  );
}
