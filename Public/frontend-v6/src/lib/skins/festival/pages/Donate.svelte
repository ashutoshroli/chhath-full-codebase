<script lang="ts">
  import DonateContent from '$lib/components/DonateContent.svelte';
  import { tr } from '$lib/stores/lang';
  import { CARD } from '../fest';
</script>

<svelte:head><title>{$tr('donate_title')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-black text-[rgb(var(--fest-ink))]">{$tr('donate_title')}</h1>
<DonateContent surfaceClass={CARD} />
