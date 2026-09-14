<script lang="ts">
  import VerifyContent from '$lib/components/VerifyContent.svelte';
  import { tr } from '$lib/stores/lang';
  import { GLASS } from '../glass';
</script>

<svelte:head><title>{$tr('verify_title')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-black text-white">{$tr('verify_title')}</h1>
<VerifyContent surfaceClass={GLASS} />
