<script lang="ts">
  // Ported from React views/ReceiptTemplates.jsx — thin wrapper over the shared
  // TemplateEditor with receipt-specific config (heading, placeholders, api).
  import { api } from '$lib/api';
  import TemplateEditor from '$lib/components/TemplateEditor.svelte';

  const SAMPLE_PLACEHOLDERS = {
    RECEIPT_NO: 'NCS-2026-1', NAME: 'Ramesh Verma', DATE: '2026-08-10', YEAR: '2026',
    FATHER_NAME: 'Suresh Verma', VILLAGE: 'Shaharpura', DESIGNATION: '', MOBILE: '9876543210',
    AMOUNT: '501', DETAIL: 'Cash contribution', GENERATED_AT: new Date().toLocaleString('en-IN')
  };
  const PLACEHOLDER_HINTS = ['RECEIPT_NO', 'NAME', 'DATE', 'YEAR', 'FATHER_NAME', 'VILLAGE', 'DESIGNATION', 'MOBILE', 'AMOUNT', 'DETAIL', 'GENERATED_AT', 'QR_CODE'];

  const apiGroup = {
    list: () => api.getReceiptTemplates(),
    get: (year: string) => api.getReceiptTemplate(year),
    save: (year: string, text: string, pageSize: string) => api.saveReceiptTemplate(year, text, pageSize),
    copy: (fromYear: string, toYear: string) => api.copyReceiptTemplate(fromYear, toYear),
    remove: (year: string) => api.deleteReceiptTemplate(year)
  };
</script>

<TemplateEditor
  heading="Receipt Templates"
  deleteLabel="receipt template"
  samplePlaceholders={SAMPLE_PLACEHOLDERS}
  placeholderHints={PLACEHOLDER_HINTS}
  {apiGroup}
/>
