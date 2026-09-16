<script lang="ts">
  // Ported from React views/ConsentTemplates.jsx — edit the loaner/guarantor
  // consent-page markdown templates with a live preview.
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { api } from '$lib/api';

  const TYPES: [string, string][] = [
    ['loaner_consent', 'Loaner Consent'],
    ['guarantor_consent', 'Guarantor Consent']
  ];

  const PLACEHOLDERS = [
    'LOANER_NAME', 'GUARANTOR_NAME', 'LOAN_AMOUNT', 'MONTHLY_INTEREST_RATE', 'MINIMUM_TENURE_MONTHS',
    'FINAL_REPAYMENT_DATE', 'FINAL_REPAYMENT_DAY_NAME', 'FUND_YEAR', 'LOAN_CONSENT_ID', 'CONSENT_ID',
    'DIWALI_NEXT_DAY_DATE', 'DIWALI_NEXT_DAY_DAY_NAME', 'NAHAY_KHAY_DATE', 'NAHAY_KHAY_DAY_NAME',
    'CHHATH_MORNING_ARGHYA_DATE', 'CHHATH_MORNING_ARGHYA_DAY_NAME',
    'GUARANTOR_1_NAME', 'GUARANTOR_1_STATUS', 'GUARANTOR_2_NAME', 'GUARANTOR_2_STATUS', 'GUARANTOR_3_NAME', 'GUARANTOR_3_STATUS',
    'ACCEPTED_COUNT', 'PENDING_COUNT', 'DECLINED_COUNT'
  ];

  let type = $state(TYPES[0][0]);
  let text = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let preview = $state(false);
  let error = $state('');

  // React: useEffect on [type].
  let lastType = '';
  $effect(() => {
    if (type === lastType) return;
    lastType = type;
    loading = true;
    error = '';
    api.getConsentPageTemplate(type)
      .then((row: any) => (text = row.text || ''))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  });

  async function save() {
    saving = true;
    error = '';
    try {
      await api.updateConsentPageTemplate(type, text);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  let previewHtml = $derived(preview ? DOMPurify.sanitize(marked.parse(text) as string) : '');
</script>

<h2 style="margin-bottom:15px;">Consent Templates</h2>
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}

<div style="display:flex; gap:8px; margin-bottom:15px;">
  {#each TYPES as [val, lbl] (val)}
    <button class="nav-btn {type === val ? 'active' : ''}" onclick={() => (type = val)}>{lbl}</button>
  {/each}
</div>

<div class="glass-card" style="padding:15px; margin-bottom:15px;">
  <strong style="font-size:0.85rem;">Available Placeholders</strong>
  <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
    {#each PLACEHOLDERS as p (p)}
      <code style="background:#f3f4f6; padding:2px 6px; border-radius:4px; font-size:0.7rem;">[{p}]</code>
    {/each}
  </div>
  <p style="font-size:0.75rem; color:var(--text-muted); margin-top:8px;">
    Markdown supported: ## heading, **bold**, *italic*, --- line, numbered/bullet lists. The Checkbox and Accept/Decline buttons are not part of this text — they appear automatically on the page.
  </p>
  <p style="font-size:0.75rem; color:var(--danger); margin-top:8px;">
    <strong>Note:</strong> <code>[GENERATED_AT]</code> and <code>[QR_CODE]</code> are <strong>not</strong> available on this
    consent page — they only work in the Word/.docx consent template. If you type them here they will
    appear as plain text exactly as written.
    <code>GUARANTOR_4</code> and beyond also work automatically if a loan ever has more than 3 guarantors.
  </p>
</div>

{#if loading}
  <div class="inline-spinner">Loading...</div>
{:else}
  <div class="glass-card" style="padding:15px;">
    <div style="display:flex; gap:8px; margin-bottom:10px;">
      <button class="btn-submit" style="width:auto;" onclick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => (preview = !preview)}>
        {preview ? 'Edit' : 'Preview'}
      </button>
    </div>
    {#if preview}
      <div class="consent-doc" style="border:1px solid #eee; border-radius:8px; padding:15px;">{@html previewHtml}</div>
    {:else}
      <textarea
        bind:value={text}
        rows={22}
        style="width:100%; font-family:monospace; font-size:0.8rem; padding:10px; border-radius:8px; border:1px solid #ddd;"
      ></textarea>
    {/if}
  </div>
{/if}
