import { useEffect, useRef } from 'react';
import { createVisibilityPoller } from './visibilityPoller.js';

// The framework-free half lives in visibilityPoller.js so it can be unit-tested
// without react present — see the note in that file (audit P-8).

/**
 * React wrapper. `fn` is held in a ref so a caller can pass an inline arrow without
 * restarting the interval on every render.
 */
export function usePolling(fn, intervalMs, deps = []) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    return createVisibilityPoller(
      () => fnRef.current(),
      intervalMs,
      typeof document === 'undefined' ? null : document
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
