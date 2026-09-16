<script lang="ts">
  // Ported from React VillageInput.jsx — village dropdown (from the Village
  // dropdown list) with an "Other" custom-entry mode using TransliterateInput.
  import { createDropdownList } from '$lib/dropdownList';
  import TransliterateInput from './TransliterateInput.svelte';

  interface Props {
    value?: string;
    hiValue?: string;
    onChange: (en: string, hi?: string) => void;
    /** Forwarded to the <select> so a caller's <label for=...> can name it (PR-40). */
    id?: string;
  }
  let { value = '', hiValue = '', onChange, id }: Props = $props();

  const villageList = createDropdownList('Village');
  let villageNames = $state<string[]>([]);
  const unsub = villageList.subscribe((s) => (villageNames = s.options.map((o) => o['English Value'])));
  $effect(() => () => unsub());

  // audit PR-40: deliberate one-time capture. This is EDITABLE local state seeded from a
  // prop; making it `$derived` would discard whatever the operator has typed every time the
  // parent re-rendered. The prop is re-read where it genuinely needs to be (see the $effect).
  // svelte-ignore state_referenced_locally
  let customMode = $state(Boolean(value) && !villageList.current().some((o) => o['English Value'] === value));

  $effect(() => {
    if (value && villageNames.length && !villageNames.includes(value)) customMode = true;
    else if (villageNames.includes(value)) customMode = false;
  });
</script>

<select
  {id}
  value={customMode ? 'Other' : value || ''}
  onchange={(e) => {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v === 'Other') {
      customMode = true;
      onChange('', '');
    } else {
      customMode = false;
      onChange(v, villageList.hindiOf(v));
    }
  }}
>
  <option value="" disabled>-- Select Village --</option>
  {#each villageNames as v}
    <option value={v}>{v}</option>
  {/each}
  <option value="Other">Other</option>
</select>
{#if customMode}
  <div style="margin-top:8px;">
    <TransliterateInput
      label="Village"
      placeholder="Enter village name"
      value={{ en: value || '', hi: hiValue || '' }}
      onChange={({ en, hi }) => onChange(en, hi)}
    />
  </div>
{/if}
