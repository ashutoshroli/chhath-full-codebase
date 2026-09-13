<script lang="ts">
  import CountUp from './CountUp.svelte';

  interface Props {
    /** 0..100 */
    percent: number;
    label?: string;
    size?: number;
  }
  let { percent, label = '', size = 104 }: Props = $props();

  const stroke = 9;
  let r = $derived((size - stroke) / 2);
  let circumference = $derived(2 * Math.PI * r);
  let clamped = $derived(Math.min(100, Math.max(0, percent || 0)));
  let offset = $derived(circumference * (1 - clamped / 100));
</script>

<div class="relative shrink-0" style="width:{size}px;height:{size}px">
  <svg width={size} height={size} viewBox="0 0 {size} {size}" style="transform:rotate(-90deg)">
    <circle
      cx={size / 2}
      cy={size / 2}
      {r}
      fill="none"
      stroke="currentColor"
      class="text-slate-200 dark:text-white/10"
      stroke-width={stroke}
    />
    <circle
      cx={size / 2}
      cy={size / 2}
      {r}
      fill="none"
      stroke="url(#ringGrad)"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={circumference}
      stroke-dashoffset={offset}
      style="transition: stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1)"
    />
    <defs>
      <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#F58C28" />
        <stop offset="100%" stop-color="#D3630F" />
      </linearGradient>
    </defs>
  </svg>
  <div class="absolute inset-0 flex flex-col items-center justify-center">
    <span class="text-xl font-black leading-none">
      <CountUp value={clamped} format={(n) => `${n.toFixed(1)}%`} />
    </span>
    {#if label}
      <span class="mt-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
    {/if}
  </div>
</div>
