import { useEffect, useRef } from 'react';
import { addLayer } from '../lib/layers';

/**
 * Registers an overlay as open over the workspace while `active` (2026-11-06,
 * lib/layers.ts): Escape then closes it, and only it while it is the topmost,
 * and the keys that act on the report behind hold back. `onClose` is held in
 * a ref, so an inline arrow does not re-register it on every render.
 */
export function useLayer(onClose: () => void, active = true, id = 'layer'): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    return addLayer({ id, close: () => closeRef.current() });
  }, [active, id]);
}
