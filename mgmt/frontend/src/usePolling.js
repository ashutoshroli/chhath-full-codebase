import { useEffect, useRef } from 'react';
import { createVisibilityPoller } from './visibilityPoller.js';


export function usePolling(fn, intervalMs, deps = []) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    return createVisibilityPoller(
      () => fnRef.current(),
      intervalMs,
      typeof document === 'undefined' ? null : document
    );
  }, [intervalMs, ...deps]);
}
