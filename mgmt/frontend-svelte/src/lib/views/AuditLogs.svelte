<script lang="ts">
  // Ported from React views/AuditLogs.jsx — tabbed audit view: Login Attempts,
  // Activity Trail (+ cleanup), Locked Accounts, User Sessions.
  import CleanupPanel from '$lib/components/CleanupPanel.svelte';
  import LoginAttempts from '$lib/components/audit/LoginAttempts.svelte';
  import ActivityTrail from '$lib/components/audit/ActivityTrail.svelte';
  import LockedAccounts from '$lib/components/audit/LockedAccounts.svelte';
  import UserSessions from '$lib/components/audit/UserSessions.svelte';

  interface Props {
    role: string;
  }
  let { role }: Props = $props();

  let tab = $state('logins');

  const TABS: [string, string][] = [
    ['logins', 'Login Attempts'],
    ['activity', 'Activity Trail'],
    ['locked', 'Locked Accounts'],
    ['sessions', 'User Sessions']
  ];
</script>

<div>
  <h2 style="margin-bottom:6px;">Activity &amp; Login Logs</h2>
  <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:14px;">
    Login history, currently locked accounts, and active devices per user.
  </p>

  <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
    {#each TABS as [id, label] (id)}
      <button type="button" onclick={() => (tab = id)} class={tab === id ? 'btn-submit' : 'btn-outline'} style="width:auto; padding:8px 14px; font-size:0.85rem;">
        {label}
      </button>
    {/each}
  </div>

  {#if tab === 'logins'}
    <LoginAttempts />
  {:else if tab === 'activity'}
    <ActivityTrail />
    <CleanupPanel target="activity_log" label="the Activity Log" {role} />
  {:else if tab === 'locked'}
    <LockedAccounts />
  {:else if tab === 'sessions'}
    <UserSessions />
  {/if}
</div>
