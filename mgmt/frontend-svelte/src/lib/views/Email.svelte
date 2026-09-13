<script lang="ts">
  // Ported from React views/Email.jsx — the noreply mail admin with sub-tabs:
  // Collection templates, Loan templates, Mails log (+ cleanup), and Queue.
  import CleanupPanel from '$lib/components/CleanupPanel.svelte';
  import EmailTemplateList from '$lib/components/email/EmailTemplateList.svelte';
  import LoanEmailTemplateList from '$lib/components/email/LoanEmailTemplateList.svelte';
  import MailLog from '$lib/components/email/MailLog.svelte';
  import EmailQueueLog from '$lib/components/email/EmailQueueLog.svelte';

  interface Props {
    role: string;
  }
  let { role }: Props = $props();

  const LOAN_TEMPLATE_TYPES: [string, string][] = [
    ['consent_personal_loaner', 'Consent — Loaner'],
    ['consent_personal_guarantor', 'Consent — Guarantor'],
    ['consent_accepted_loaner_personal', 'Accepted — Loaner'],
    ['all_guarantors_accepted_loaner', 'All Guarantors Accepted'],
    ['consent_verified_personal', 'Verified — Personal'],
    ['loan_passed_personal', 'Loan Passed — Loaner'],
    ['disbursement', 'Disbursement'],
    ['otp', 'OTP']
  ];

  let emailSection = $state('template');
  let loanEmailType = $state(LOAN_TEMPLATE_TYPES[0][0]);
</script>

<h2 style="margin-bottom:15px;">✉️ Mail (noreply)</h2>

<div class="subtabs">
  <button class="subtab-btn {emailSection === 'template' ? 'active' : ''}" onclick={() => (emailSection = 'template')}>Collection</button>
  <button class="subtab-btn {emailSection === 'loan' ? 'active' : ''}" onclick={() => (emailSection = 'loan')}>Loan</button>
  <button class="subtab-btn {emailSection === 'mails' ? 'active' : ''}" onclick={() => (emailSection = 'mails')}>Mails</button>
  <button class="subtab-btn {emailSection === 'queue' ? 'active' : ''}" onclick={() => (emailSection = 'queue')}>Queue</button>
</div>

{#if emailSection === 'template'}
  <EmailTemplateList />
{/if}
{#if emailSection === 'loan'}
  <div class="subtabs" style="margin-top:8px;">
    {#each LOAN_TEMPLATE_TYPES as [val, lbl] (val)}
      <button class="subtab-btn {loanEmailType === val ? 'active' : ''}" onclick={() => (loanEmailType = val)}>{lbl}</button>
    {/each}
  </div>
  {#key loanEmailType}
    <LoanEmailTemplateList loanType={loanEmailType} />
  {/key}
{/if}
{#if emailSection === 'mails'}
  <MailLog />
  <CleanupPanel target="noreply_mails" label="noreply emails" {role} hasStatus />
{/if}
{#if emailSection === 'queue'}
  <EmailQueueLog />
{/if}
