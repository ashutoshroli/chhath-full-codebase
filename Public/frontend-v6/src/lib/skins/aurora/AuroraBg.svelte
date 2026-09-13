<script lang="ts">
  /** Animated aurora mesh background — a few large blurred blobs drifting.
   *  Decorative, GPU-cheap, disabled under reduced-motion (app.css). */
  interface Props { still?: boolean; }
  let { still = false }: Props = $props();
  const blobs = [
    { c: '#7c5cff', x: '12%', y: '8%', s: 360, d: '0s' },
    { c: '#22d3ee', x: '70%', y: '4%', s: 320, d: '3s' },
    { c: '#f472b6', x: '55%', y: '55%', s: 380, d: '6s' },
    { c: '#f59e0b', x: '5%', y: '60%', s: 300, d: '9s' }
  ];
</script>

<div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0a0f1e]" aria-hidden="true">
  {#each blobs as b}
    <div
      class="absolute rounded-full blur-[70px] {still ? '' : 'animate-aurora'}"
      style="left:{b.x}; top:{b.y}; width:{b.s}px; height:{b.s}px; background:{b.c}; opacity:.55; animation-delay:{b.d};"
    ></div>
  {/each}
  <!-- subtle grain/darken to keep text readable -->
  <div class="absolute inset-0 bg-[#0a0f1e]/40"></div>
</div>
