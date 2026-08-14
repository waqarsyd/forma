/**
 * Geometry for the workspace's resizable review column.
 *
 * This is a clamp and a parse, and it is extracted rather than inlined because
 * both of its failure modes are silent and self-perpetuating. The width is
 * persisted, so it is read back from a string that a hand edit, a shared
 * profile or a future bug can make arbitrary: a stored `4` leaves a column too
 * narrow to find the resize handle in, a stored `9999` pushes the bench off
 * screen, and both survive every reload because the value that broke the layout
 * is the same value the layout writes back.
 *
 * The maximum is deliberately not a constant. It also depends on the viewport,
 * because a column dragged wide on a 2560px monitor must not eat the window
 * when the same profile is opened on a laptop — so the caller passes the width
 * it actually has and gets back one that leaves a bench worth drawing on.
 */

/** The ported artifact's own column width, and what a reset returns to. */
export const REVIEW_DEFAULT_WIDTH = 340;
/** Below this the composer and the note cards stop being usable. */
export const REVIEW_MIN_WIDTH = 260;
/**
 * Above this the column stops reading as a side panel.
 *
 * It was 720, then briefly 1000 to give the rail's widen button somewhere worth
 * jumping to. That button is gone, and 1000 turned out to be a chat column
 * filling two thirds of a 1600px window — reported as "too huge", correctly.
 * 560 is 65% more room than the default for a long transcript while the bench
 * still holds the report, which is the thing being worked on.
 *
 * The viewport allowance below applies on top, so this is a ceiling rather than
 * a promise: on a narrow window the widest column is whatever fits.
 */
export const REVIEW_MAX_WIDTH = 560;
/** The 56px rail plus the narrowest bench a report sheet still fits in. */
export const REVIEW_BENCH_RESERVE = 476;

/**
 * The nearest usable width to the one asked for.
 *
 * `viewportWidth` defaults to `Infinity` so the pure bounds apply on their own;
 * pass `window.innerWidth` to also keep the bench alive. The minimum always
 * wins over the viewport allowance — a window too narrow to satisfy both is one
 * where the layout has already stacked into a single column and the width is
 * not being used at all.
 */
export function clampReviewWidth(width: number, viewportWidth: number = Infinity): number {
  if (!Number.isFinite(width)) return REVIEW_DEFAULT_WIDTH;

  const room = Number.isFinite(viewportWidth) ? viewportWidth - REVIEW_BENCH_RESERVE : REVIEW_MAX_WIDTH;
  const max = Math.max(REVIEW_MIN_WIDTH, Math.min(REVIEW_MAX_WIDTH, room));

  return Math.round(Math.min(Math.max(width, REVIEW_MIN_WIDTH), max));
}

/**
 * A stored width, or the default.
 *
 * Anything unparseable, empty, negative or absent falls back rather than
 * throwing, for the same reason `mergeStoredConfig` does: a corrupted entry
 * must not stop the workspace loading.
 */
export function readReviewWidth(raw: string | null, viewportWidth: number = Infinity): number {
  if (raw === null || raw.trim() === '') return clampReviewWidth(REVIEW_DEFAULT_WIDTH, viewportWidth);

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return clampReviewWidth(REVIEW_DEFAULT_WIDTH, viewportWidth);

  return clampReviewWidth(parsed, viewportWidth);
}
