<script lang="ts">
  /** Animated number count-up; respects reduced-motion (jumps to final value). */
  import { browser } from '$app/environment';

  interface Props {
    value: number;
    duration?: number;
    format?: (n: number) => string;
  }
  let { value, duration = 900, format = (n) => Math.round(n).toString() }: Props = $props();

  let display = $state(0);

  $effect(() => {
    const target = value || 0;
    if (!browser) {
      display = target;
      return;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || duration <= 0) {
      display = target;
      return;
    }
    const start = performance.now();
    const from = display;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      display = from + (target - from) * eased;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<span>{format(display)}</span>
