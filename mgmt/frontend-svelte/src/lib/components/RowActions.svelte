<script lang="ts">
  // Ported from React RowActions.jsx — kebab menu with Edit/Delete gated by role
  // (canEdit/canDelete). Same markup/styles.
  import { canEdit, canDelete } from '$lib/permissions';

  interface Props {
    role: string;
    onEdit?: (() => void) | null;
    onDelete?: (() => void) | null;
    disabled?: boolean;
  }
  let { role, onEdit = null, onDelete = null, disabled = false }: Props = $props();

  let open = $state(false);
  let ref: HTMLDivElement | undefined = $state();

  let showEdit = $derived(!disabled && canEdit(role) && !!onEdit);
  let showDelete = $derived(!disabled && canDelete(role) && !!onDelete);

  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref && !ref.contains(e.target as Node)) open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') open = false; };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  });

  function pick(fn: () => void) {
    return (e: Event) => { e.stopPropagation(); open = false; fn(); };
  }
</script>

{#if showEdit || showDelete}
  <div class="row-actions-menu" bind:this={ref} style="position:relative; flex-shrink:0;">
    <button
      type="button"
      class="icon-btn"
      title="Actions"
      aria-label="Actions"
      aria-haspopup="menu"
      aria-expanded={open}
      onclick={(e) => { e.stopPropagation(); open = !open; }}
    >
      <span class="material-icons-round" style="font-size:18px;">more_vert</span>
    </button>
    {#if open}
      <div
        role="menu"
        style="position:absolute; top:100%; right:0; margin-top:4px; z-index:30; background:#fff; border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,0.15); border:1px solid #eee; min-width:130px; overflow:hidden;"
      >
        {#if showEdit}
          <button
            type="button"
            role="menuitem"
            onclick={pick(onEdit!)}
            style="display:flex; align-items:center; gap:8px; width:100%; padding:10px 12px; background:none; border:none; cursor:pointer; font-size:0.85rem; color:#111;"
          >
            <span class="material-icons-round" style="font-size:16px;">edit</span> Edit
          </button>
        {/if}
        {#if showDelete}
          <button
            type="button"
            role="menuitem"
            onclick={pick(onDelete!)}
            style="display:flex; align-items:center; gap:8px; width:100%; padding:10px 12px; background:none; border:none; cursor:pointer; font-size:0.85rem; color:var(--danger, #dc2626); border-top:{showEdit ? '1px solid #f1f1f1' : 'none'};"
          >
            <span class="material-icons-round" style="font-size:16px;">delete</span> Delete
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
