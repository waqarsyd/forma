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
export function boxToSourceRect(box?: number[]): SourceRect | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box;
  if (![ymin, xmin, ymax, xmax].every((n) => typeof n === 'number' && isFinite(n))) return null;

  const x = xmin / 1000;
  const y = ymin / 1000;
  const width = (xmax - xmin) / 1000;
  const height = (ymax - ymin) / 1000;

  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** The crop rectangle for an element: detection box first, legacy field second. */
export function sourceRectFor(el: ReportElement): SourceRect | null {
  return boxToSourceRect(el.box2d) ?? el.sourceRect ?? null;
}
