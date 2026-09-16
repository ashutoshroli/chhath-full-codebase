<script lang="ts">
  // Ported from React views/DocxTemplates.jsx — per doc-type .docx template
  // management: download sample, upload year template, copy year, delete year,
  // and the full in-Word authoring instructions.
  import { api } from '$lib/api';

  type DocTypeEntry = [string, string, string, string[]];
  const DOC_TYPES: DocTypeEntry[] = [
    ['receipt', 'Receipt', 'receipt-sample.docx', ['RECEIPT_NO', 'DATE', 'YEAR', 'NAME', 'FATHER_NAME', 'VILLAGE', 'DESIGNATION', 'MOBILE', 'DETAIL', 'AMOUNT', 'GENERATED_AT', 'QR_CODE']],
    ['receipt_work', 'Receipt — Work', 'receipt-work-sample.docx', ['RECEIPT_NO', 'DATE', 'YEAR', 'NAME', 'FATHER_NAME', 'VILLAGE', 'DESIGNATION', 'MOBILE', 'DETAIL', 'AMOUNT', 'GENERATED_AT', 'QR_CODE']],
    ['certificate', 'Certificate', 'certificate-sample.docx', ['CERT_NO', 'DATE', 'NAME', 'DETAIL', 'VILLAGE', 'FATHER_NAME', 'DESIGNATION', 'YEAR', 'GENERATED_AT', 'QR_CODE']],
    ['samaan', 'Material', 'samaan-sample.docx', ['SAMAAN_NO', 'DATE', 'NAME', 'ITEM_DETAIL', 'VILLAGE', 'FATHER_NAME', 'YEAR', 'GENERATED_AT', 'QR_CODE']],
    ['consent_loaner', 'Consent — Loaner', 'consent-loaner-sample.docx', [
      'LOAN_CONSENT_ID', 'FUND_YEAR', 'LOANER_NAME', 'LOAN_AMOUNT', 'MONTHLY_INTEREST_RATE', 'MINIMUM_TENURE_MONTHS', 'FINAL_REPAYMENT_DATE', 'FINAL_REPAYMENT_DAY_NAME',
      'GUARANTOR_1_NAME', 'GUARANTOR_1_STATUS', 'GUARANTOR_2_NAME', 'GUARANTOR_2_STATUS', 'GUARANTOR_3_NAME', 'GUARANTOR_3_STATUS',
      'ACCEPTED_COUNT', 'PENDING_COUNT', 'DECLINED_COUNT',
      'DIWALI_NEXT_DAY_DATE', 'DIWALI_NEXT_DAY_DAY_NAME', 'NAHAY_KHAY_DATE', 'NAHAY_KHAY_DAY_NAME', 'CHHATH_MORNING_ARGHYA_DATE', 'CHHATH_MORNING_ARGHYA_DAY_NAME',
      'GENERATED_AT', 'QR_CODE'
    ]],
    ['consent_guarantor', 'Consent — Guarantor', 'consent-guarantor-sample.docx', [
      'CONSENT_ID', 'LOAN_CONSENT_ID', 'FUND_YEAR', 'GUARANTOR_NAME', 'LOANER_NAME', 'LOAN_AMOUNT', 'MONTHLY_INTEREST_RATE', 'MINIMUM_TENURE_MONTHS', 'FINAL_REPAYMENT_DATE', 'FINAL_REPAYMENT_DAY_NAME',
      'ACCEPTED_COUNT', 'PENDING_COUNT', 'DECLINED_COUNT',
      'DIWALI_NEXT_DAY_DATE', 'DIWALI_NEXT_DAY_DAY_NAME', 'NAHAY_KHAY_DATE', 'NAHAY_KHAY_DAY_NAME', 'CHHATH_MORNING_ARGHYA_DATE', 'CHHATH_MORNING_ARGHYA_DAY_NAME',
      'GENERATED_AT', 'QR_CODE'
    ]],
    ['report_en', 'Report — English', 'report-en-sample.docx', [
      'YEAR', 'TOTAL_COLLECTION', 'PAST_RETURN', 'TOTAL_EXPENSES', 'TOTAL_BUDGET', 'SURPLUS', 'GENERATED_AT',
      '#loans', 'LOAN_TAKER', 'AMOUNT', 'INTEREST', 'TENURE', 'STATUS', '/loans',
      '#guarantors', 'GUARANTOR_NAME', 'LOAN_TAKER', 'YEAR', '/guarantors',
      '#contributors', 'SL_NO', 'NAME', 'FATHER_NAME', 'VILLAGE', 'AMOUNT', '/contributors',
      '#expenses', 'SL_NO', 'DESCRIPTION', 'CATEGORY', 'AMOUNT', '/expenses'
    ]],
    ['report_hi', 'Report — Hindi', 'report-hi-sample.docx', [
      'YEAR', 'TOTAL_COLLECTION', 'PAST_RETURN', 'TOTAL_EXPENSES', 'TOTAL_BUDGET', 'SURPLUS', 'GENERATED_AT',
      '#loans', 'LOAN_TAKER_HI', 'AMOUNT', 'INTEREST', 'TENURE', 'STATUS_HI', '/loans',
      '#guarantors', 'GUARANTOR_NAME_HI', 'LOAN_TAKER_HI', 'YEAR', '/guarantors',
      '#contributors', 'SL_NO', 'NAME_HI', 'FATHER_NAME_HI', 'VILLAGE_HI', 'AMOUNT', '/contributors',
      '#expenses', 'SL_NO', 'DESCRIPTION_HI', 'CATEGORY_HI', 'AMOUNT', '/expenses'
    ]],
    ['report_both', 'Report — Both', 'report-both-sample.docx', [
      'YEAR', 'TOTAL_COLLECTION', 'PAST_RETURN', 'TOTAL_EXPENSES', 'TOTAL_BUDGET', 'SURPLUS', 'GENERATED_AT',
      '#loans', 'LOAN_TAKER', 'LOAN_TAKER_HI', 'AMOUNT', 'INTEREST', 'TENURE', 'STATUS', 'STATUS_HI', '/loans',
      '#guarantors', 'GUARANTOR_NAME', 'GUARANTOR_NAME_HI', 'LOAN_TAKER', 'LOAN_TAKER_HI', 'YEAR', '/guarantors',
      '#contributors', 'SL_NO', 'NAME', 'NAME_HI', 'FATHER_NAME', 'FATHER_NAME_HI', 'VILLAGE', 'VILLAGE_HI', 'AMOUNT', '/contributors',
      '#expenses', 'SL_NO', 'DESCRIPTION', 'DESCRIPTION_HI', 'CATEGORY', 'CATEGORY_HI', 'AMOUNT', '/expenses'
    ]]
  ];

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = () => reject(new Error('File could not be read'));
      reader.readAsDataURL(file);
    });
  }

  let docType = $state(DOC_TYPES[0][0]);
  let years = $state<any[]>([]);
  let uploadYear = $state('');
  let file = $state<File | null>(null);
  let uploading = $state(false);
  let error = $state('');
  let showCopy = $state(false);
  let copyFrom = $state('');
  let copyTo = $state('');
  let showInstructions = $state(false);

  let current = $derived(DOC_TYPES.find((d) => d[0] === docType)!);

  function refresh() {
    api.getDocxTemplates(docType).then((y: any[]) => (years = y)).catch((err: Error) => (error = err.message));
  }

  // React: useEffect on [docType] — reload list, clear error.
  let lastDocType = '';
  $effect(() => {
    if (docType === lastDocType) return;
    lastDocType = docType;
    refresh();
    error = '';
  });

  async function upload(e: Event) {
    e.preventDefault();
    if (!uploadYear) { alert('Please enter a year'); return; }
    if (!file) { alert('Please select a .docx file'); return; }
    uploading = true;
    error = '';
    try {
      const base64 = await fileToBase64(file);
      await api.uploadDocxTemplate(docType, uploadYear, base64, file.name);
      uploadYear = '';
      file = null;
      refresh();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      uploading = false;
    }
  }

  async function doCopy() {
    if (!copyFrom || !copyTo) return;
    uploading = true;
    error = '';
    try {
      await api.copyDocxTemplate(docType, copyFrom, copyTo);
      copyFrom = '';
      copyTo = '';
      showCopy = false;
      refresh();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      uploading = false;
    }
  }

  async function remove(year: string) {
    if (!confirm(`Delete the ${current[1]} template for Year ${year}?`)) return;
    try {
      await api.deleteDocxTemplate(docType, year);
      refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  let isReport = $derived(docType.startsWith('report'));
</script>

<h2 style="margin-bottom:15px;">Document Templates (Word / .docx)</h2>
{#if error}<div class="error-banner">{error}</div>{/if}

<div class="subtabs" style="margin-bottom:15px;">
  {#each DOC_TYPES as [val, lbl] (val)}
    <button class="subtab-btn {docType === val ? 'active' : ''}" onclick={() => (docType = val)}>{lbl}</button>
  {/each}
</div>

<div class="glass-card" style="padding:15px; margin-bottom:15px;">
  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
    <strong>{current[1]} — Sample Template</strong>
    <a href={`/sample-templates/${current[2]}`} download class="btn-submit" style="width:auto; text-decoration:none; text-align:center;">
      ⬇ Download Sample .docx
    </a>
  </div>
  <p style="font-size:0.8rem; color:var(--text-muted); margin:8px 0 0;">
    This sample already comes with a professional design — open it in Word and edit it directly (colors, logo, layout — change whatever you like), keep the placeholders (like <code>{'{NAME}'}</code>) as they are, and upload it here.
  </p>
  <button type="button" class="btn-submit" style="width:auto; margin-top:10px; background:#e5e7eb; color:#111;" onclick={() => (showInstructions = !showInstructions)}>
    {showInstructions ? 'Hide Instructions' : '📖 How to Create a Template in Word'}
  </button>

  {#if showInstructions}
    <div style="background:#f9fafb; border-radius:8px; padding:15px; margin-top:12px; font-size:0.85rem; line-height:1.6;">
      <p><strong>1. How to write a placeholder:</strong> Wherever you need data in Word, write the name inside curly braces — e.g. <code>{'{NAME}'}</code>, <code>{'{AMOUNT}'}</code>. The spelling/CAPS must match exactly (see the list below).</p>
      <p><strong>2. How to create a table:</strong> Use Word's regular "Insert Table". Each cell can contain a placeholder or a label — e.g. "Name" in one column and <code>{'{NAME}'}</code> in the next. No matter how long the table is (many rows), if the content doesn't fit on one page, Word/Google will automatically continue it onto the next page — nothing extra is needed.</p>
      <p><strong>3. Watermark:</strong> Add it via Word's "Design → Watermark" (both text and image work) — it will appear in the PDF exactly as it looks in Word.</p>
      <p><strong>4. Page Size:</strong> Set A4/A5/custom via Word's "Layout → Size" — the PDF will be generated in the same size.</p>
      <p><strong>5. Page Break:</strong> If new content after a table should start on the next page, use Word's "Insert → Page Break" — this will also be followed correctly in the PDF.</p>
      <p><strong>6. Bold/Color/Font:</strong> All of Word's regular formatting (bold, color, font size) will appear the same way in the PDF.</p>
      <p><strong>7. QR Code:</strong> To insert the scannable QR code image, write <code>{'{%QR_CODE}'}</code> (with a <code>%</code> right after the opening brace) at the spot where you want the QR to appear — Word will show it as plain text until the PDF is generated, where it becomes the actual scannable image.</p>
      {#if isReport}
        <p><strong>8. Repeating table rows (loops):</strong> This template has repeating tables (loans, guarantors, contributors, expenses). Make ONE table row with the column placeholders — e.g. <code>{'{LOAN_TAKER}'}</code>, <code>{'{AMOUNT}'}</code> — then put <code>{'{#loans}'}</code> at the very start of that row's first cell and <code>{'{/loans}'}</code> at the very end of the row's last cell (same for <code>{'{#guarantors}'}</code>/<code>{'{/guarantors}'}</code>, <code>{'{#contributors}'}</code>/<code>{'{/contributors}'}</code>, <code>{'{#expenses}'}</code>/<code>{'{/expenses}'}</code>). That one row repeats automatically for every record.</p>
        <p><strong>9. "No records" fallback (inverted section):</strong> To show a line only when a list is EMPTY, wrap it in <code>{'{^loans}'}</code> ... <code>{'{/loans}'}</code> (note the <code>^</code> instead of <code>#</code>) — e.g. <code>{'{^loans}'}</code>No loans this year<code>{'{/loans}'}</code>. The same works for <code>{'{^guarantors}'}</code>, <code>{'{^contributors}'}</code> and <code>{'{^expenses}'}</code>. The shipped sample templates already use this.</p>
        <p><strong>10. Hindi columns:</strong> for the Hindi report use the <code>_HI</code> placeholders (e.g. <code>{'{NAME_HI}'}</code>, <code>{'{STATUS_HI}'}</code>) — the plain <code>{'{NAME}'}</code> version prints the ENGLISH value. Both are always available, so mixing them in the "Both" template is fine. If a person's Hindi name is blank in the User record, the Hindi placeholder renders blank — there is no automatic transliteration at PDF time.</p>
      {/if}
      <p style="color:var(--danger);"><strong>Note:</strong> Make sure there's no extra space or spelling mismatch inside a placeholder (e.g. <code>{'{ NAME }'}</code> or <code>{'{Name}'}</code> will not work) — copy-pasting from the list below is safest. A placeholder that doesn't exist renders as <strong>blank</strong> (it does not show an error), so double-check the spelling if a field comes out empty.</p>
      <p style="color:var(--danger);"><strong>Curly braces:</strong> <code>{'{'}</code> and <code>{'}'}</code> are reserved for placeholders. Do <strong>not</strong> type a literal curly brace anywhere else in the document — it will break the whole template.</p>

      <p style="margin-top:10px;"><strong>Available Placeholders for {current[1]}:</strong></p>
      <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
        {#each current[3] as p (p)}
          <code style="background:#fff; border:1px solid #ddd; padding:2px 6px; border-radius:4px; font-size:0.75rem;">{p === 'QR_CODE' ? '{%QR_CODE}' : `{${p}}`}</code>
        {/each}
      </div>
    </div>
  {/if}
</div>

<div class="glass-card" style="padding:15px; margin-bottom:15px;">
  <strong>Existing Years</strong>
  <div style="display:flex; gap:8px; flex-wrap:wrap; margin:10px 0;">
    {#if years.length === 0}
      <span style="font-size:0.85rem; color:var(--text-muted);">No template has been uploaded yet.</span>
    {/if}
    {#each years as y (y.year)}
      <div class="badge" style="background:#f3f4f6; color:#374151; display:flex; align-items:center; gap:6px;">
        {y.year} — {y.file_name}
        <button type="button" class="btn-bare material-icons-round" style="font-size:1rem; color:var(--danger);"
          aria-label="Remove the {y.year} template" onclick={() => remove(y.year)}>close</button>
      </div>
    {/each}
  </div>
  <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => (showCopy = !showCopy)} disabled={years.length === 0}>
    Copy as New Year
  </button>
  {#if showCopy}
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap;">
      <select bind:value={copyFrom}>
        <option value="">From year...</option>
        {#each years as y (y.year)}<option value={y.year}>{y.year}</option>{/each}
      </select>
      <input placeholder="To year" type="number" bind:value={copyTo} style="max-width:130px;" />
      <button class="btn-submit" style="width:auto;" onclick={doCopy} disabled={uploading || !copyFrom || !copyTo}>Copy</button>
    </div>
  {/if}
</div>

<div class="glass-card" style="padding:15px;">
  <strong>Upload .docx Template</strong>
  <form onsubmit={upload}>
    <div class="form-group">
      <label>Year</label>
      <input type="number" bind:value={uploadYear} placeholder="e.g. 2026" />
    </div>
    <div class="form-group">
      <label>.docx File</label>
      <input type="file" accept=".docx" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] || null)} />
    </div>
    <button class="btn-submit" disabled={uploading}>{uploading ? 'Uploading...' : 'Upload'}</button>
  </form>
</div>
