<script lang="ts">
  // Ported from React TwoFactorInput.jsx — 6-digit OTP boxes + backup-code mode.
  interface Props {
    onSubmit: (code: string) => void;
    disabled?: boolean;
    error?: string;
    resetKey?: number;
  }
  let { onSubmit, disabled = false, error = '', resetKey = 0 }: Props = $props();

  const LEN = 6;
  let digits = $state<string[]>(Array(LEN).fill(''));
  let useBackup = $state(false);
  let backup = $state('');
  let inputs: (HTMLInputElement | null)[] = $state(Array(LEN).fill(null));

  // Reset on resetKey change (e.g. after a wrong code).
  $effect(() => {
    void resetKey;
    digits = Array(LEN).fill('');
    if (!useBackup) inputs[0]?.focus();
  });
  $effect(() => {
    void useBackup;
    if (!useBackup) inputs[0]?.focus();
  });

  function submitCode(code: string) {
    if (disabled) return;
    onSubmit(code);
  }

  function handleChange(i: number, val: string) {
    const only = val.replace(/\D/g, '');
    if (!only) {
      digits[i] = '';
      digits = [...digits];
      return;
    }
    const chars = only.split('');
    const next = [...digits];
    let idx = i;
    for (const c of chars) {
      if (idx >= LEN) break;
      next[idx] = c;
      idx++;
    }
    digits = next;
    const nextFocus = Math.min(idx, LEN - 1);
    inputs[nextFocus]?.focus();
    if (next.every((d) => d !== '')) submitCode(next.join(''));
  }

  function handleKeyDown(i: number, e: KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      digits[i - 1] = '';
      digits = [...digits];
      inputs[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      inputs[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < LEN - 1) {
      inputs[i + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, LEN);
    if (!text) return;
    e.preventDefault();
    const next = Array(LEN).fill('');
    for (let k = 0; k < text.length; k++) next[k] = text[k];
    digits = next;
    const focusAt = Math.min(text.length, LEN - 1);
    inputs[focusAt]?.focus();
    if (text.length === LEN) submitCode(text);
  }

  function submitBackup(e: Event) {
    e.preventDefault();
    if (disabled) return;
    const v = backup.trim();
    if (v) onSubmit(v);
  }
</script>

{#if useBackup}
  <form onsubmit={submitBackup} style="margin-top:8px;">
    {#if error}<div class="error-banner">{error}</div>{/if}
    <div class="form-group">
      <label>Backup code</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={backup}
        placeholder="XXXXX-XXXXX"
        autocomplete="one-time-code"
        autofocus
        {disabled}
        style="letter-spacing:0.08em; text-transform:uppercase;"
      />
    </div>
    <button class="btn-submit" type="submit" disabled={disabled || !backup.trim()}>
      {disabled ? 'Verifying…' : 'Verify backup code'}
    </button>
    <button
      type="button"
      onclick={() => { useBackup = false; backup = ''; }}
      style="display:block; margin:12px auto 0; background:none; border:none; color:var(--accent, #2563eb); cursor:pointer; font-size:0.85rem;"
    >
      ← Use my authenticator app instead
    </button>
  </form>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div style="margin-top:8px;">
    {#if error}<div class="error-banner">{error}</div>{/if}
    <label style="display:block; margin-bottom:8px; font-size:0.9rem;">
      Enter the 6-digit code from your authenticator app
    </label>
    <div style="display:flex; gap:8px; justify-content:center;" onpaste={handlePaste}>
      {#each digits as d, i (i)}
        <input
          bind:this={inputs[i]}
          value={d}
          oninput={(e) => handleChange(i, (e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => handleKeyDown(i, e)}
          {disabled}
          inputmode="numeric"
          autocomplete={i === 0 ? 'one-time-code' : 'off'}
          maxlength="1"
          aria-label={`Digit ${i + 1}`}
          style="width:44px; height:54px; text-align:center; font-size:1.5rem; border-radius:8px; border:1px solid #cbd5e1; padding:0;"
        />
      {/each}
    </div>
    {#if disabled}<p style="text-align:center; color:var(--text-muted); font-size:0.85rem; margin-top:10px;">Verifying…</p>{/if}
    <button
      type="button"
      onclick={() => (useBackup = true)}
      style="display:block; margin:16px auto 0; background:none; border:none; color:var(--accent, #2563eb); cursor:pointer; font-size:0.85rem;"
    >
      Can’t use your app? Use a backup code
    </button>
  </div>
{/if}
