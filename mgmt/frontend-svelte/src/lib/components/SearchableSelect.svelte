<script lang="ts">
  // Ported from React SearchableSelect.jsx — searchable dropdown with optional
  // "add new" button. Same inline styles/markup.
  //
  // audit PR-38. This is the control that decides WHO a contribution, a loan or a guarantee
  // belongs to, and it is mounted in five places, every one of them a money path. It could
  // not be operated by keyboard AT ALL: the options were `<div onclick>`, so there was no
  // ArrowDown, no Enter, no Escape, and nothing focusable to activate. A keyboard-only
  // operator could type a search and then had no way to choose any result — the money could
  // not be attributed without a mouse.
  //
  // It also had no ARIA: no combobox role, no expanded state, no listbox, no options, no
  // active-descendant. A screen-reader user got a plain text box, was never told a list had
  // appeared, and was never told what was highlighted.
  //
  // Now an ARIA 1.2 combobox with `aria-activedescendant`. That pattern keeps DOM focus on
  // the input while the highlight moves through the list, which is what lets the user keep
  // typing to narrow the search — moving real focus into the options would break that.
  interface Option { value: string; label: string; sub?: string; }
  interface Props {
    options: Option[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    onAddNew?: (() => void) | null;
    /** Forwarded to the combobox input so a caller's <label for=...> can name it (PR-40). */
    id?: string;
  }
  let { options, value, onChange, placeholder = 'Search...', onAddNew = null, id }: Props = $props();

  let query = $state('');
  let open = $state(false);
  let boxEl: HTMLDivElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();
  // -1 means "nothing highlighted": Enter must not pick somebody the user never chose.
  let active = $state(-1);

  const uid = Math.random().toString(36).slice(2, 9);
  const listId = `ss-list-${uid}`;
  const optId = (i: number) => `ss-opt-${uid}-${i}`;

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
  // Clamped rather than stored raw: after typing narrows the list, a stale index would point
  // `aria-activedescendant` at an option that no longer exists — announced as nothing at all.
  let activeIdx = $derived(active < 0 ? -1 : Math.min(active, filtered.length - 1));

  function choose(o: Option) {
    onChange(o.value);
    close();
    query = '';
  }

  function close() {
    open = false;
    active = -1;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { open = true; query = ''; active = 0; return; }
      const last = filtered.length - 1;
      if (last < 0) return;
      // Clamped, not wrapped: wrapping past the end of a 2,000-name list is disorienting
      // when you cannot see where you are.
      active = e.key === 'ArrowDown'
        ? Math.min((activeIdx < 0 ? -1 : activeIdx) + 1, last)
        : Math.max((activeIdx < 0 ? 0 : activeIdx) - 1, 0);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (!open || !filtered.length) return;
      e.preventDefault();
      active = e.key === 'Home' ? 0 : filtered.length - 1;
      return;
    }
    if (e.key === 'Enter') {
      if (!open || activeIdx < 0) return; // nothing highlighted -> do not guess
      e.preventDefault();
      choose(filtered[activeIdx]);
      return;
    }
    if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation(); // do not also close the dialog this picker sits in
      close();
      return;
    }
    if (e.key === 'Tab') close(); // leaving the control commits nothing
  }

  $effect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (boxEl && !boxEl.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  });
</script>

<div bind:this={boxEl} style="position:relative;">
  <div style="display:flex; gap:8px;">
    <input
      bind:this={inputEl}
      {id}
      {placeholder}
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open && activeIdx >= 0 ? optId(activeIdx) : undefined}
      value={open ? query : selected ? selected.label : ''}
      onfocus={() => { open = true; query = ''; }}
      oninput={(e) => { query = (e.currentTarget as HTMLInputElement).value; active = -1; }}
      onkeydown={onKeydown}
    />
    {#if onAddNew}
      <button
        type="button"
        class="btn-outline"
        style="flex-shrink:0; width:44px; min-height:44px;"
        onclick={onAddNew}
        aria-label="Add new"
        title="Add new"
      >
        <span class="material-icons-round" style="font-size:18px; vertical-align:middle;" aria-hidden="true">add</span>
      </button>
    {/if}
  </div>
  <!-- The listbox is always in the DOM so `aria-controls` never dangles; it is emptied and
       hidden when closed. -->
  <div
    id={listId}
    role="listbox"
    hidden={!open}
    style="position:absolute; top:100%; left:0; right:{onAddNew ? '52px' : '0'}; background:white; border:1px solid #ddd; border-radius:8px; max-height:220px; overflow-y:auto; z-index:10; box-shadow:var(--shadow);"
  >
    {#if open}
      {#each filtered as o, i (o.value)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          id={optId(i)}
          role="option"
          tabindex="-1"
          aria-selected={o.value === value}
          data-active={i === activeIdx ? 'true' : undefined}
          onclick={() => choose(o)}
          onmousedown={(e) => e.preventDefault()}
          onmouseenter={() => (active = i)}
          style="padding:10px 12px; min-height:44px; cursor:pointer; border-bottom:1px solid #f3f4f6; {i === activeIdx ? 'background:#f3f4f6;' : ''}"
        >
          <div style="font-weight:600; font-size:0.9rem;">{o.label}</div>
          {#if o.sub}<div style="font-size:0.75rem; color:var(--text-muted);">{o.sub}</div>{/if}
        </div>
      {/each}
    {/if}
  </div>
  <!-- "No matches" was a silent visual-only div. A search that finds nothing is exactly when
       a screen-reader user needs telling. -->
  <div role="status" aria-live="polite" style="position:absolute; left:0; right:0; top:100%;">
    {#if open && filtered.length === 0}
      <div style="padding:10px; background:white; border:1px solid #ddd; border-radius:8px; color:var(--text-muted); font-size:0.9rem;">
        No matches
      </div>
    {/if}
  </div>
</div>
