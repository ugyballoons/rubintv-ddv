import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * A ref that always holds the latest value, assigned in a layout effect rather
 * than during render. Lets handlers registered once (for example on an ECharts
 * instance) call the current callback without re-registering.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
