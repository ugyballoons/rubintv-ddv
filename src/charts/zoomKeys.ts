import { useEffect, useState } from 'react';

/**
 * Holding X or Y while zooming constrains the zoom to that axis, as in the
 * Flutter charts. Tracked globally so any chart under the cursor honours it.
 */
let held: 'x' | 'y' | null = null;
const listeners = new Set<(k: 'x' | 'y' | null) => void>();
function set(k: 'x' | 'y' | null) {
  if (held === k) return;
  held = k;
  for (const l of listeners) l(k);
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (
      e.repeat ||
      (e.target as HTMLElement | null)?.tagName === 'INPUT' ||
      (e.target as HTMLElement | null)?.tagName === 'TEXTAREA'
    )
      return;
    if (e.key === 'x' || e.key === 'X') set('x');
    else if (e.key === 'y' || e.key === 'Y') set('y');
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'y') set(null);
  });
  window.addEventListener('blur', () => set(null));
}

export function useZoomAxisKey(): 'x' | 'y' | null {
  const [k, setK] = useState(held);
  useEffect(() => {
    listeners.add(setK);
    return () => {
      listeners.delete(setK);
    };
  }, []);
  return k;
}
