import { useEffect, useState, type RefObject } from 'react';

/**
 * The scale that fits a page `pageWidth` wide into `el`, never above 1, told
 * to `set` now and whenever `el` is resized; the function returned stops it.
 * The Mockup and the Preview each carried a copy of these lines until
 * 2026-11-06 (the workspace audit); one copy cannot drift from the other.
 */
export function observeFit(el: HTMLElement, pageWidth: number, set: (scale: number) => void): () => void {
  const measure = () => {
    const available = el.clientWidth;
    if (available > 0) set(Math.min(1, available / pageWidth));
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(el);
  return () => observer.disconnect();
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
