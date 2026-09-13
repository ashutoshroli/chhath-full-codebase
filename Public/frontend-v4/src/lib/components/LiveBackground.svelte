<script lang="ts">
  /**
   * Immersive but lightweight "live" Chhath background — layered CSS only
   * (sunrise glow, gentle water shimmer, floating diya particles). NO video.
   *
   * Performance / accessibility:
   *  - All motion is CSS animation; disabled entirely under
   *    prefers-reduced-motion (see app.css) and can be turned off via `still`.
   *  - Particles are a small fixed count; positions are precomputed once.
   *  - Fully decorative -> aria-hidden, pointer-events:none, sits behind content.
   */
  interface Props {
    /** Render without animation (used for reduced-motion / low-power). */
    still?: boolean;
  }
  let { still = false }: Props = $props();

  // Precompute a handful of diya particles (deterministic, no layout thrash).
  const diyas = Array.from({ length: 9 }, (_, i) => ({
    left: 6 + i * 10.5 + ((i * 37) % 5),
    bottom: 12 + ((i * 53) % 190),
    delay: ((i * 0.7) % 4).toFixed(2),
    scale: 0.7 + ((i * 13) % 7) / 10
  }));
</script>

<div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
  <!-- Sky gradient: warm dawn (light) / deep dusk-to-saffron (dark) -->
  <div
    class="absolute inset-0 bg-gradient-to-b from-[#FDE7C9] via-[#FBC98C] to-[#E98B54]
      dark:from-[#241033] dark:via-[#5b2733] dark:to-[#e2691f]"
  ></div>

  <!-- Sun / glow -->
  <div
    class="absolute left-1/2 top-[14vh] h-56 w-56 -translate-x-1/2 rounded-full blur-[2px]
      md:h-72 md:w-72
      {still ? '' : 'animate-sunrise'}"
    style="background: radial-gradient(circle, #FFE9A8 0%, #FFC24B 34%, #FF8A2B 60%, rgba(255,138,43,0) 72%);"
  ></div>

  <!-- Soft vignette to keep foreground text readable -->
  <div
    class="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-white/40
      dark:from-black/20 dark:via-transparent dark:to-black/50"
  ></div>

  <!-- Ghat / temple silhouette (tiny vector via CSS mask so it tints per theme
       and adds zero extra paint cost; sits on the horizon above the water). -->
  <div
    class="absolute inset-x-0 bottom-40 h-24 bg-brand-900/20 dark:bg-black/45 sm:bottom-44 sm:h-32"
    style="
      -webkit-mask: url('/ghat-silhouette.svg') bottom center / cover no-repeat;
      mask: url('/ghat-silhouette.svg') bottom center / cover no-repeat;
    "
  ></div>

  <!-- Water band with shimmering ripples -->
  <div class="absolute inset-x-0 bottom-0 h-56 overflow-hidden">
    <div
      class="absolute inset-0 bg-gradient-to-b from-[rgba(255,150,60,0.28)] to-[rgba(60,60,120,0.15)]
        dark:from-[rgba(226,105,31,0.25)] dark:to-[rgba(10,16,32,0.5)]"
    ></div>
    <div
      class="absolute -left-1/3 -right-1/3 top-6 h-16 opacity-70 {still ? '' : 'animate-ripple'}"
      style="background: radial-gradient(ellipse at center, rgba(255,255,255,.35), transparent 70%);"
    ></div>
    <div
      class="absolute -left-1/3 -right-1/3 top-20 h-16 opacity-50 {still ? '' : 'animate-ripple'}"
      style="background: radial-gradient(ellipse at center, rgba(255,255,255,.28), transparent 70%); animation-duration: 9s;"
    ></div>
  </div>

  <!-- Floating diya particles -->
  {#if !still}
    {#each diyas as d}
      <span
        class="absolute h-2 w-2 rounded-full animate-floatUp"
        style="left:{d.left}%; bottom:{d.bottom}px; animation-delay:{d.delay}s; transform:scale({d.scale});
          background: radial-gradient(circle, #FFE9A8, #FF9A3C);
          box-shadow: 0 0 10px 3px rgba(255,170,60,.7);"
      ></span>
    {/each}
  {/if}
</div>
