<script lang="ts">
  // Ported from the WhatsAppSettings sub-component of React views/WhatsApp.jsx —
  // edit the OTP/consent sender number portal setting.
  import { api } from '$lib/api';

  let value = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');

  let loaded = false;
  $effect(() => {
    if (loaded) return;
    loaded = true;
    api.getPortalSetting('otp_consent_sender_number')
      .then((res: any) => (value = res.value || ''))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  });

  async function save() {
    saving = true;
    error = '';
    try {
      await api.setPortalSetting('otp_consent_sender_number', value.trim());
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="glass-card" style="padding:15px;">
  <strong>OTP / Consent Sender Number</strong>
  <p style="font-size:0.8rem; color:var(--text-muted); margin:4px 0 10px;">
    Loan OTP and Consent-related messages will be sent "from" this number (10-digit number). This does not apply to any other message types.
  </p>
  {#if error}<div role="alert" class="error-banner" style="margin-bottom:10px;">{error}</div>{/if}
  {#if loading}
    <div class="inline-spinner">Loading...</div>
  {:else}
    <input
      value={value}
      maxlength={10}
      inputmode="numeric"
      placeholder="10 digit number"
      oninput={(e) => (value = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10))}
      style="margin-bottom:10px;"
    />
    <button class="btn-submit" style="width:auto;" onclick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
  {/if}
</div>
