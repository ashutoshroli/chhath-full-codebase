<script lang="ts">
 import { portalState,year } from '$lib/stores/portal'; import { tr,lang } from '$lib/stores/lang'; import { committeeForYear } from '$lib/api/derive'; import { initials } from '$lib/utils/format'; import { Users } from '@lucide/svelte';
 let members=$derived(committeeForYear($portalState.data,$year));
</script>
<svelte:head><title>{$tr('active_committee')} — {$tr('app_title')}</title></svelte:head>
<div class="kinetic-command"><div class="kinetic-kicker">04 / PEOPLE</div><h1 class="kinetic-title">Committee.</h1></div><p class="kinetic-subtitle">{$tr('active_committee')} / {$year==='All'?$tr('all_years'):$year}</p>
<div class="kinetic-panel kinetic-panel--teal" style="margin-bottom:14px"><Users/><div class="kinetic-label">MEMBERS ON RECORD</div><div class="kinetic-number">{members.length}</div></div>
<div class="kinetic-grid kinetic-grid--3">{#each members as member,i}<article class="kinetic-panel"><div class="kinetic-avatar">{initials(member.name)}</div><div class="kinetic-label" style="margin-top:12px">{member.role||'COMMITTEE'}</div><h2 style="font-size:22px;line-height:1;margin:6px 0;font-weight:950">{$lang==='hi'&&member.nameHindi?member.nameHindi:member.name}</h2><div class="kinetic-micro">{$lang==='hi'&&member.villageHindi?member.villageHindi:member.village}</div>{#if member.designation}<div class="kinetic-chip" style="margin-top:12px">{$lang==='hi'&&member.designationHindi?member.designationHindi:member.designation}</div>{/if}</article>{/each}</div>{#if members.length===0}<div class="kinetic-panel">{$tr('no_committee')}</div>{/if}
