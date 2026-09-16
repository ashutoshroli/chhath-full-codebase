<script lang="ts">
  // Ported from React TwoFactorSettings.jsx — enroll/confirm/disable/regenerate
  // TOTP 2FA for eligible (Superadmin) accounts, with QR + backup codes.
  import { api } from '$lib/api';
  import { generateQrDataUrl } from '$lib/qrCode';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  let status = $state<any>(null);
  let loading = $state(true);
  let err = $state('');
  let busy = $state(false);

  let enroll = $state<any>(null);
  let code = $state('');
  let showBackup = $state<any>(null);
  let disablePw = $state('');
  let regenPw = $state('');

  function loadStatus() {
    loading = true;
    api.get2FAStatus()
      .then((s: any) => (status = s))
      .catch((e: Error) => (err = e.message))
      .finally(() => (loading = false));
  }
  let started = false;
  $effect(() => { if (started) return; started = true; loadStatus(); });

  async function startEnroll() {
    err = ''; busy = true;
    try {
      const res: any = await api.enroll2FA();
      let qrDataUrl = '';
      try { qrDataUrl = await generateQrDataUrl(res.otpauthUri, 220); } catch (e) { /* ignore */ }
      enroll = { ...res, qrDataUrl };
      showBackup = null;
    } catch (e) { err = (e as Error).message; }
    finally { busy = false; }
  }

  async function confirmEnroll() {
    err = ''; busy = true;
    try {
      await api.confirm2FA(code.replace(/\D/g, ''), enroll.backupCodes, enroll.recoveryKey);
      showBackup = { backupCodes: enroll.backupCodes, recoveryKey: enroll.recoveryKey };
      enroll = null;
      code = '';
      loadStatus();
    } catch (e) { err = (e as Error).message; }
    finally { busy = false; }
  }

  async function doDisable() {
    if (!disablePw) return;
    if (!confirm('Turn OFF two-factor authentication for your account?')) return;
    err = ''; busy = true;
    try {
      await api.disable2FA(disablePw);
      disablePw = ''; showBackup = null;
      loadStatus();
    } catch (e) { err = (e as Error).message; }
    finally { busy = false; }
  }

  async function doRegen() {
    if (!regenPw) return;
    err = ''; busy = true;
    try {
      const res: any = await api.regenerate2FABackupCodes(regenPw);
      showBackup = { backupCodes: res.backupCodes };
      regenPw = '';
      loadStatus();
    } catch (e) { err = (e as Error).message; }
    finally { busy = false; }
  }

  function downloadCodes(data: any) {
    const lines: string[] = [];
    lines.push('Chhath Puja Portal — 2FA recovery information');
    lines.push('Keep this file private and safe.');
    lines.push('');
    if (data.recoveryKey) {
      lines.push('RECOVERY KEY (disables 2FA if your phone is lost):');
      lines.push('  ' + data.recoveryKey);
      lines.push('');
    }
    lines.push('BACKUP CODES (each works once):');
    (data.backupCodes || []).forEach((c: string) => lines.push('  ' + c));
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chhath-2fa-recovery.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const box = 'border:1px solid var(--border, #e2e2e2); border-radius:10px; padding:12px; margin-top:10px;';
  const codeGrid = 'display:grid; grid-template-columns:1fr 1fr; gap:6px; font-family:monospace; font-size:0.95rem; margin:8px 0;';
</script>

{#if loading}
  <div class="inline-spinner">Loading 2FA…</div>
{:else if !status || !status.eligible}
  <!-- not eligible: render nothing (matches React return null) -->
{:else}
  <div style="margin-top:28px;">
    <h4 style="margin-bottom:6px;">Two-Factor Authentication</h4>
    <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:10px;">
      Protect your Superadmin login with an authenticator app (Google Authenticator, Authy…).
    </p>
    {#if err}<div role="alert" class="error-banner" style="margin-bottom:10px;">{err}</div>{/if}

    {#if showBackup}
      <div style="{box} border-color:var(--success, #16a34a);">
        <strong>Save these now — shown only once.</strong>
        {#if showBackup.recoveryKey}
          <div style="margin:8px 0;">
            <div style="font-size:0.8rem; color:var(--text-muted);">Recovery key (disables 2FA if your phone is lost):</div>
            <div style="font-family:monospace; font-size:1rem; word-break:break-all;">{showBackup.recoveryKey}</div>
          </div>
        {/if}
        <div style="font-size:0.8rem; color:var(--text-muted);">Backup codes (each works once):</div>
        <div style={codeGrid}>{#each showBackup.backupCodes as c (c)}<span>{c}</span>{/each}</div>
        <button type="button" class="btn-submit" onclick={() => downloadCodes(showBackup)} style="margin-top:4px;">Download</button>
        <button type="button" onclick={() => (showBackup = null)} style="display:block; margin:10px auto 0; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.82rem;">I've saved them</button>
      </div>
    {/if}

    {#if enroll}
      <div style={box}>
        <p style="margin-top:0; font-size:0.9rem;">1. Scan this QR in your authenticator app:</p>
        {#if enroll.qrDataUrl}
          <img src={enroll.qrDataUrl} alt="2FA QR code" width={220} height={220} style="display:block; margin:0 auto;" />
        {:else}
          <div style="font-size:0.85rem;">Could not render QR — enter this key manually:</div>
        {/if}
        <p style="font-size:0.78rem; color:var(--text-muted); text-align:center; word-break:break-all;">
          Manual key: <code>{enroll.secret}</code>
        </p>
        <div style="{box} background:rgba(0,0,0,0.02);">
          <div style="font-size:0.8rem; color:var(--text-muted);">Save your recovery key + backup codes BEFORE confirming — shown only once:</div>
          <div style="margin:6px 0;"><strong>Recovery key:</strong> <span style="font-family:monospace;">{enroll.recoveryKey}</span></div>
          <div style={codeGrid}>{#each enroll.backupCodes as c (c)}<span>{c}</span>{/each}</div>
          <button type="button" onclick={() => downloadCodes(enroll)} style="font-size:0.8rem;">Download recovery info</button>
        </div>
        <p style="font-size:0.9rem; margin-bottom:4px;">2. Enter the 6-digit code to finish:</p>
        <input value={code} oninput={(e) => (code = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))} inputmode="numeric" placeholder="000000" maxlength={6} style="letter-spacing:0.3em; text-align:center; font-size:1.2rem;" />
        <button type="button" class="btn-submit" disabled={busy || code.length !== 6} onclick={confirmEnroll} style="margin-top:8px;">
          {busy ? 'Verifying…' : 'Enable 2FA'}
        </button>
        <button type="button" onclick={() => { enroll = null; code = ''; }} style="display:block; margin:10px auto 0; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.82rem;">Cancel</button>
      </div>
    {/if}

    {#if !enroll && !status.enabled}
      <button type="button" class="btn-submit" disabled={busy} onclick={startEnroll}>
        {busy ? 'Starting…' : 'Enable Two-Factor Authentication'}
      </button>
    {/if}

    {#if !enroll && status.enabled}
      <div style={box}>
        <div style="color:var(--success, #16a34a); font-weight:600; margin-bottom:8px;">
          ✓ 2FA is ON · {status.backupCodesRemaining} backup code{status.backupCodesRemaining === 1 ? '' : 's'} left
        </div>

        <div style="margin-bottom:14px;">
          <label for={`${uid}-f1`} style="font-size:0.85rem;">Regenerate backup codes (enter password):</label>
          <input id={`${uid}-f1`} type="password" bind:value={regenPw} placeholder="Your password" />
          <button type="button" class="btn-submit" disabled={busy || !regenPw} onclick={doRegen} style="margin-top:6px;">
            Regenerate backup codes
          </button>
        </div>

        <div>
          <label for={`${uid}-f2`} style="font-size:0.85rem;">Disable 2FA (enter password):</label>
          <input id={`${uid}-f2`} type="password" bind:value={disablePw} placeholder="Your password" />
          <button type="button" class="btn-danger" disabled={busy || !disablePw} onclick={doDisable} style="margin-top:6px;">
            Turn off 2FA
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
