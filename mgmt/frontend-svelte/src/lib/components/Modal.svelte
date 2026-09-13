<script lang="ts">
  // Ported from React Modal.jsx — same markup/classes (modal-overlay,
  // modal-content, modal-close-btn) so styling is identical.
  interface Props {
    open: boolean;
    onClose?: () => void;
    children?: import('svelte').Snippet;
  }
  let { open, onClose, children }: Props = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class="modal-content">
      {#if onClose}
        <button type="button" class="modal-close-btn" aria-label="Close" title="Close" onclick={onClose}>
          <span class="material-icons-round">close</span>
        </button>
      {/if}
      {@render children?.()}
    </div>
  </div>
{/if}
