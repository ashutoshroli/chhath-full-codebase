<script lang="ts">
  // Ported from React SearchableSelect.jsx — searchable dropdown with optional
  // "add new" button. Same inline styles/markup.
  interface Option { value: string; label: string; sub?: string; }
  interface Props {
    options: Option[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    onAddNew?: (() => void) | null;
  }
  let { options, value, onChange, placeholder = 'Search...', onAddNew = null }: Props = $props();

  let query = $state('');
  let open = $state(false);
  let boxEl: HTMLDivElement | undefined = $state();

  let selected = $derived(options.find((o) => o.value === value));
  let filtered = $derived(
    options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          (o.sub || '').toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 50)
  );

  $effect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (boxEl && !boxEl.contains(e.target as Node)) open = false;
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  });
</script>

<div bind:this={boxEl} style="position:relative;">
  <div style="display:flex; gap:8px;">
    <input
      {placeholder}
      value={open ? query : selected ? selected.label : ''}
      onfocus={() => { open = true; query = ''; }}
      oninput={(e) => (query = (e.currentTarget as HTMLInputElement).value)}
    />
    {#if onAddNew}
      <button type="button" class="btn-outline" style="flex-shrink:0; width:44px;" onclick={onAddNew} title="Add new">
        <span class="material-icons-round" style="font-size:18px; vertical-align:middle;">add</span>
      </button>
    {/if}
  </div>
  {#if open}
    <div
      style="position:absolute; top:100%; left:0; right:{onAddNew ? '52px' : '0'}; background:white; border:1px solid #ddd; border-radius:8px; max-height:220px; overflow-y:auto; z-index:10; box-shadow:var(--shadow);"
    >
      {#if filtered.length === 0}
        <div style="padding:10px; color:var(--text-muted); font-size:0.9rem;">No matches</div>
      {/if}
      {#each filtered as o (o.value)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          onclick={() => { onChange(o.value); open = false; query = ''; }}
          onmousedown={(e) => e.preventDefault()}
          style="padding:10px 12px; cursor:pointer; border-bottom:1px solid #f3f4f6;"
        >
          <div style="font-weight:600; font-size:0.9rem;">{o.label}</div>
          {#if o.sub}<div style="font-size:0.75rem; color:var(--text-muted);">{o.sub}</div>{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
