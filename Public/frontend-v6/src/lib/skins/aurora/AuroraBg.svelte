<script lang="ts">
  /** Animated aurora mesh background — a few large blurred blobs drifting.
   *  Decorative, GPU-cheap, disabled under reduced-motion (app.css).
   *
   *  Palette-driven: blob colors + base come from CSS custom properties
   *  (--aurora-b1..b4, --aurora-bg) so the aurora skin re-tints per theme
   *  (Neon Noir / Cyber Lime / Sunset Vapor / Mint Frost each get their own
   *  look). The fallbacks below are the original Aurora violet palette, so the
   *  base "aurora" theme is unchanged. */
  interface Props { still?: boolean; }
  let { still = false }: Props = $props();
  const blobs = [
    { v: 'var(--aurora-b1, #7c5cff)', x: '12%', y: '8%', s: 360, d: '0s' },
    { v: 'var(--aurora-b2, #22d3ee)', x: '70%', y: '4%', s: 320, d: '3s' },
    { v: 'var(--aurora-b3, #f472b6)', x: '55%', y: '55%', s: 380, d: '6s' },
    { v: 'var(--aurora-b4, #f59e0b)', x: '5%', y: '60%', s: 300, d: '9s' }
  ];
</script>

<div
  class="pointer-events-none fixed inset-0 -z-10 overflow-hidden aurora-base"
  aria-hidden="true"
>
  {#each blobs as b}
    <div
      class="absolute rounded-full blur-[70px] {still ? '' : 'animate-aurora'}"
      style="left:{b.x}; top:{b.y}; width:{b.s}px; height:{b.s}px; background:{b.v}; opacity:.55; animation-delay:{b.d};"
    ></div>
  {/each}
  <!-- subtle grain/darken to keep text readable -->
  <div class="absolute inset-0 aurora-base-overlay"></div>
</div>

<style>
  .aurora-base {
    background: var(--aurora-bg, #0a0f1e);
  }
  .aurora-base-overlay {
    /* same base color at 40% to darken behind text */
    background: color-mix(in srgb, var(--aurora-bg, #0a0f1e) 40%, transparent);
  }
</style>
