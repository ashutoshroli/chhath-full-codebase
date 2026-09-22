<script lang="ts">
 import { tr } from '$lib/stores/lang'; import VerifyContent from '$lib/components/VerifyContent.svelte'; import { ShieldCheck } from '@lucide/svelte';
</script>
<svelte:head><title>{$tr('verify_title')} — {$tr('app_title')}</title></svelte:head>
<div class="kinetic-command"><div class="kinetic-kicker">08 / AUTHENTICITY</div><h1 class="kinetic-title">Verify.</h1></div><p class="kinetic-subtitle">{$tr('verify_subtitle')}</p><section class="kinetic-panel kinetic-panel--teal"><ShieldCheck/><div style="margin-top:10px"><VerifyContent surfaceClass="surface"/></div></section>
