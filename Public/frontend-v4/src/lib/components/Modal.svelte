<script lang="ts">
  /** Generic accessible modal: backdrop + Esc close, scroll-locked, centered
   *  sheet on desktop / bottom-sheet on mobile. Content via the default slot. */
  import { X } from '@lucide/svelte';
  import { browser } from '$app/environment';

  interface Props {
    open: boolean;
    title?: string;
    onclose: () => void;
    children?: import('svelte').Snippet;
  }
  let { open, title = '', onclose, children }: Props = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  // Lock body scroll while open.
  $effect(() => {
    if (!browser) return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => (document.body.style.overflow = prev);
    }
  });
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
    onclick={onclose}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="surface flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-b-none rounded-t-3xl sm:max-h-[80vh] sm:rounded-3xl"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={title}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
        <h2 class="text-base font-black">{title}</h2>
        <button class="chip !h-8 !w-8 !px-0" onclick={onclose} aria-label="Close">
          <X class="h-4 w-4" />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        {@render children?.()}
      </div>
    </div>
  </div>
{/if}
