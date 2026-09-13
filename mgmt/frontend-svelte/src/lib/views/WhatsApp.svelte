<script lang="ts">
  // Ported from React views/WhatsApp.jsx — WhatsApp admin with sections:
  // Template (person/group/loan), Group Info, Message log (+ cleanup), Settings.
  import CleanupPanel from '$lib/components/CleanupPanel.svelte';
  import WaTemplateList from '$lib/components/whatsapp/WaTemplateList.svelte';
  import GroupInfoList from '$lib/components/whatsapp/GroupInfoList.svelte';
  import MessageLog from '$lib/components/whatsapp/MessageLog.svelte';
  import WhatsAppSettings from '$lib/components/whatsapp/WhatsAppSettings.svelte';

  interface Props {
    role: string;
  }
  let { role }: Props = $props();

  const LOAN_TEMPLATE_TYPES: [string, string][] = [
    ['consent_group', 'Consent — Group'],
    ['consent_personal_loaner', 'Consent — Personal (Loaner)'],
    ['consent_personal_guarantor', 'Consent — Personal (Guarantor)'],
    ['consent_accepted_group', 'Accepted — Group'],
    ['consent_accepted_loaner_personal', 'Accepted — Loaner Personal'],
    ['all_guarantors_accepted_loaner', 'All Guarantors Accepted — Loaner'],
    ['consent_verified_personal', 'Verified — Personal'],
    ['loan_passed_personal', 'Loan Passed — Loaner'],
    ['disbursement', 'Disbursement'],
    ['otp', 'OTP']
  ];

  let section = $state('template');
  let templateKind = $state<'person' | 'group' | 'loan'>('person');
  let loanTemplateType = $state(LOAN_TEMPLATE_TYPES[0][0]);

  let loanTitleLabel = $derived(LOAN_TEMPLATE_TYPES.find((t) => t[0] === loanTemplateType)?.[1] || '');
</script>

<h2 style="margin-bottom:15px;">WhatsApp</h2>

<div class="subtabs">
  <button class="subtab-btn {section === 'template' ? 'active' : ''}" onclick={() => (section = 'template')}>Template</button>
  <button class="subtab-btn {section === 'groupinfo' ? 'active' : ''}" onclick={() => (section = 'groupinfo')}>Group Info</button>
  <button class="subtab-btn {section === 'message' ? 'active' : ''}" onclick={() => (section = 'message')}>Message</button>
  <button class="subtab-btn {section === 'settings' ? 'active' : ''}" onclick={() => (section = 'settings')}>Settings</button>
</div>

{#if section === 'template'}
  <div class="subtabs">
    <button class="subtab-btn {templateKind === 'person' ? 'active' : ''}" onclick={() => (templateKind = 'person')}>Person</button>
    <button class="subtab-btn {templateKind === 'group' ? 'active' : ''}" onclick={() => (templateKind = 'group')}>Group</button>
    <button class="subtab-btn {templateKind === 'loan' ? 'active' : ''}" onclick={() => (templateKind = 'loan')}>Loan</button>
  </div>

  {#if templateKind === 'loan'}
    <div class="subtabs" style="margin-top:8px;">
      {#each LOAN_TEMPLATE_TYPES as [val, lbl] (val)}
        <button class="subtab-btn {loanTemplateType === val ? 'active' : ''}" onclick={() => (loanTemplateType = val)}>{lbl}</button>
      {/each}
    </div>
    {#key loanTemplateType}
      <WaTemplateList kind="loan" loanType={loanTemplateType} titleLabel={loanTitleLabel} />
    {/key}
  {:else}
    {#key templateKind}
      <WaTemplateList kind={templateKind} />
    {/key}
  {/if}
{/if}

{#if section === 'groupinfo'}
  <GroupInfoList />
{/if}

{#if section === 'message'}
  <MessageLog />
  <CleanupPanel target="whatsapp_messages" label="WhatsApp messages" {role} hasStatus />
{/if}

{#if section === 'settings'}
  <WhatsAppSettings />
{/if}
