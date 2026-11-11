import { useEffect, useState, type RefObject } from 'react';

/**
 * The scale that fits a page `pageWidth` wide into `el`, never above 1, told
 * to `set` now and whenever `el` is resized; the function returned stops it.
 * The Mockup and the Preview each carried a copy of these lines until
 * 2026-11-06 (the workspace audit); one copy cannot drift from the other.
 *
 * A resize is read once per frame and told only when the scale changes
 * (2026-11-11, the full audit's PR-14): a column dragged or the sidebar
 * opened resizes the pane on every frame, and each scale told drew the
 * Preview and the workspace again, the same width or not.
 */
export function observeFit(el: HTMLElement, pageWidth: number, set: (scale: number) => void): () => void {
  let told = NaN;
  let frame = 0;
  const measure = () => {
    frame = 0;
    const available = el.clientWidth;
    if (available <= 0) return;
    const scale = Math.min(1, available / pageWidth);
    if (scale === told) return;
    told = scale;
    set(scale);
  };
  measure();
  const observer = new ResizeObserver(() => {
    frame ||= requestAnimationFrame(measure);
  });
  observer.observe(el);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

/** `observeFit` as a hook, for a page whose width is known before its scale is needed. */
export function useFitScale(ref: RefObject<HTMLElement | null>, pageWidth: number): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observeFit(el, pageWidth, setScale);
  }, [ref, pageWidth]);
  return scale;
}
