<script lang="ts">
  // Ported from the Box sub-component of React views/AnnouncePage.jsx — renders a
  // single announcement in one language (custom/resell/contribution layouts).
  interface Props {
    lang: string;
    item: any;
    onMarkAnnounced: () => void;
    marking: boolean;
  }
  let { lang, item, onMarkAnnounced, marking }: Props = $props();

  let isHindi = $derived(lang === 'hindi');
  let label = $derived(isHindi ? 'हिन्दी' : 'English');
</script>

{#if item}
  {@const kind = item.category}
  {#if kind === 'Custom' && !(isHindi ? item.textHindi : item.textEnglish)}
    <!-- React returns null when a custom item has no text in this language -->
  {:else}
    <div class="glass-card" style="padding:18px; flex:1; min-width:260px; position:relative;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
        <span style="font-size:0.7rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">{label}</span>
        <button
          class="btn-submit"
          style="width:auto; padding:4px 10px; font-size:0.75rem; background:#e5e7eb; color:#111;"
          onclick={onMarkAnnounced}
          disabled={marking}
        >
          Announced: {item.announcedCount || 0}
        </button>
      </div>

      {#if kind === 'Custom'}
        <div style="font-size:1.3rem; font-weight:600; line-height:1.5;">{isHindi ? item.textHindi : item.textEnglish}</div>
      {:else if kind === 'Resell'}
        <div style="font-size:1.5rem; font-weight:800;">{item.detail}</div>
        <div style="font-size:1.1rem; color:var(--text-muted); margin-top:6px;">₹{item.amount}</div>
      {:else}
        {@const name = isHindi ? (item.nameHindi || item.name) : item.name}
        {@const designation = isHindi ? (item.designationHindi || item.designation) : item.designation}
        {@const fatherName = isHindi ? (item.fatherNameHindi || item.fatherName) : item.fatherName}
        {@const village = isHindi ? (item.villageHindi || item.village) : item.village}
        <div style="font-size:1.6rem; font-weight:800;">{name}</div>
        {#if designation}<div style="font-size:1rem; color:var(--primary-saffron); font-weight:700; margin-top:2px;">{designation}</div>{/if}
        {#if fatherName}<div style="font-size:0.95rem; color:var(--text-muted); margin-top:4px;">{isHindi ? 'पिता:' : "Father's Name:"} {fatherName}</div>{/if}
        {#if village}<div style="font-size:0.95rem; color:var(--text-muted); margin-top:2px;">{isHindi ? 'गाँव:' : 'Village:'} {village}</div>{/if}
        <div style="font-size:1.2rem; font-weight:700; margin-top:10px;">
          {(kind === 'Kaam' || kind === 'Saman') ? item.detail : `₹${item.amount}`}
        </div>
      {/if}
    </div>
  {/if}
{/if}
