<script lang="ts">
  // Ported from React TransliterateInput.jsx — English input auto-transliterated
  // to Hindi (debounced 400ms) with a toggle to edit the Hindi manually.
  import { transliterate } from '$lib/transliterate';

  interface Val { en: string; hi: string; }
  interface Props {
    label: string;
    value: Val;
    onChange: (v: Val) => void;
    placeholder?: string;
    listId?: string;
  }
  let { label, value, onChange, placeholder = '', listId }: Props = $props();

  let en = $derived(value?.en || '');
  let hi = $derived(value?.hi || '');
  let manualHi = $state(false);
  let hiEditable = $state(false);
  let debounceId: ReturnType<typeof setTimeout> | null = null;

  // Auto-transliterate when the English text changes (unless Hindi was edited).
  $effect(() => {
    const cur = en;
    if (manualHi) return;
    if (!cur) {
      onChange({ en: cur, hi: '' });
      return;
    }
    if (debounceId) clearTimeout(debounceId);
    debounceId = setTimeout(async () => {
      const result = await transliterate(cur);
      onChange({ en: cur, hi: result });
    }, 400);
    return () => {
      if (debounceId) clearTimeout(debounceId);
    };
  });
</script>

<div class="form-group">
  <label>{label}</label>
  <input
    value={en}
    {placeholder}
    list={listId}
    oninput={(e) => {
      const v = (e.currentTarget as HTMLInputElement).value;
      if (!v) manualHi = false;
      onChange({ en: v, hi });
    }}
  />
  <div style="display:flex; align-items:center; gap:6px; margin-top:6px;">
    <input
      value={hi}
      placeholder={`${label} (Hindi)`}
      readonly={!hiEditable}
      style="background:{hiEditable ? '#fff' : '#f9fafb'}; flex-grow:1;"
      oninput={(e) => { manualHi = true; onChange({ en, hi: (e.currentTarget as HTMLInputElement).value }); }}
    />
    <button
      type="button"
      class="btn-bare material-icons-round"
      style="font-size:1.1rem; color:{hiEditable ? 'var(--primary-saffron)' : 'var(--text-muted)'};"
      title="Edit Hindi text"
      aria-label="Edit the Hindi text by hand"
      aria-pressed={hiEditable}
      onclick={() => (hiEditable = !hiEditable)}
    >
      edit
    </button>
  </div>
</div>
