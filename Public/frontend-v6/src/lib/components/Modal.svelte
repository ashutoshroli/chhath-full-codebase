<script lang="ts">
  /** Generic accessible modal: backdrop + Esc close, scroll-locked, centered
   *  sheet on desktop / bottom-sheet on mobile. Content via the default slot.
   *
   *  audit PR-36: focus management lives in `use:dialog` — focus enters on open, Tab is
   *  trapped, the page behind goes inert, and focus returns to the opener on close. None of
   *  that happened before, while `aria-modal="true"` claimed all of it. */
  import { X } from '@lucide/svelte';
  import { dialog } from '$lib/a11y/dialog';

  interface Props {
    open: boolean;
    title?: string;
    onclose: () => void;
    /** Renders as `alertdialog` — for a destructive confirmation the user must answer. */
    destructive?: boolean;
    children?: import('svelte').Snippet;
  }
  let { open, title = '', onclose, destructive = false, children }: Props = $props();

  // A dialog must be NAMED. Pointing at the visible heading (rather than repeating the
  // string into aria-label) keeps the accessible name and the rendered text from drifting;
  // the fallback covers a caller that passes no title, which used to produce
  // `aria-label=""` — announced as an anonymous "dialog".
  const titleId = `dlg-title-${Math.random().toString(36).slice(2, 9)}`;
</script>

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
      role={destructive ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      tabindex="-1"
      aria-labelledby={titleId}
      use:dialog={{ onclose }}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
        <h2 class="text-base font-black" id={titleId}>{title || 'Dialog'}</h2>
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
