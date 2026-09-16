<script lang="ts">
  // Ported from React Modal.jsx — same markup/classes (modal-overlay,
  // modal-content, modal-close-btn) so styling is identical.
  //
  // audit PR-37: this used to be two anonymous divs. No `role`, no `aria-modal`, no
  // accessible name, no Escape, no focus handling, no scroll lock — so to a screen reader
  // it was a `<div>` that happened to appear, with the whole page behind it still
  // reachable, and a keyboard-only user had no way out but to Tab to the close button.
  //
  // The behaviour now comes from `use:dialog`, byte-identical to the public portal's copy
  // (a test pins that). The NAME comes from the caller: these modals already render their
  // own `<h3>`, so `labelledBy` points at that heading instead of the primitive growing a
  // header of its own — which keeps all 23 screens pixel-identical.
  import { dialog } from '$lib/a11y/dialog';

  interface Props {
    open: boolean;
    onClose?: () => void;
    /** id of the heading inside the content that names this dialog. Preferred. */
    labelledBy?: string;
    /** Fallback name, for content that has no single heading to point at. */
    title?: string;
    /** Renders as `alertdialog` — for a destructive confirmation the user must answer. */
    destructive?: boolean;
    children?: import('svelte').Snippet;
  }
  let { open, onClose, labelledBy, title, destructive = false, children }: Props = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div
      class="modal-content"
      role={destructive ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      tabindex="-1"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : (title || 'Dialog')}
      use:dialog={{ onclose: () => onClose?.() }}
    >
      {#if onClose}
        <button type="button" class="modal-close-btn" aria-label="Close" title="Close" onclick={onClose}>
          <span class="material-icons-round">close</span>
        </button>
      {/if}
      {@render children?.()}
    </div>
  </div>
{/if}
