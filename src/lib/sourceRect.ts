/**
 * Where a picture sits inside the user's upload.
 *
 * Extracted from `App.tsx` so the coordinate convention can be tested. The
 * y-before-x ordering below is the kind of thing that fails *plausibly* — read
 * the wrong way round it produces a crop in a believable but wrong position
 * rather than an obvious error — so it is pinned by tests rather than by
 * eyeballing a rendered mockup.
 */
import type { ReportElement, SourceRect } from '../services/geminiService';

/**
 * Convert Gemini's detection box — `[ymin, xmin, ymax, xmax]` normalised to
 * 0-1000 — into the fractional rectangle the cropper works in.
 *
 * The order is y-first and that is not a typo; it is the format the model
 * emits for object detection. Reading it as x-first transposes every crop,
 * which looks like "the logo is in the wrong place" rather than an obvious bug.
 */
/** The model's documented range for a detection box. */
const BOX_MAX = 1000;

export function boxToSourceRect(box?: number[]): SourceRect | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const raw = box;
  if (!raw.every((n) => typeof n === 'number' && isFinite(n))) return null;

  /**
   * Clamped to the documented range, not merely checked for shape.
   *
   * This is model output. The guard used to catch the *malformed* cases —
   * wrong length, non-numeric, inverted — and let the *implausible* ones
   * through, which is the wrong way round for a value that fails silently: a
   * hallucinated coordinate outside 0-1000 produced a crop rectangle partly or
   * wholly outside the image, rendered without complaint. `[-1, -1, 2, 2]`
   * returned a rect with a negative origin (audit BUG-004).
   *
   * Clamping rather than rejecting, because a slightly out-of-range box is far
   * more likely to be a near-miss worth salvaging than garbage worth dropping.
   */
  const [ymin, xmin, ymax, xmax] = raw.map((n) => Math.min(BOX_MAX, Math.max(0, n)));

  const x = xmin / BOX_MAX;
  const y = ymin / BOX_MAX;
  const width = (xmax - xmin) / BOX_MAX;
  const height = (ymax - ymin) / BOX_MAX;

  // Re-checked after clamping: a box entirely outside the image collapses to
  // zero here, and a zero-area crop is not something to hand the renderer.
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** The crop rectangle for an element: detection box first, legacy field second. */
export function sourceRectFor(el: ReportElement): SourceRect | null {
  return boxToSourceRect(el.box2d) ?? el.sourceRect ?? null;
}
