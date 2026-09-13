<script lang="ts">
  // Ported from React views/SamaanTemplates.jsx — thin wrapper over the shared
  // TemplateEditor with material (samaan)-specific config.
  import { api } from '$lib/api';
  import TemplateEditor from '$lib/components/TemplateEditor.svelte';

  const SAMPLE_PLACEHOLDERS = {
    SAMAAN_NO: 'NCS-SAMAAN-2026-1', NAME: 'Ramesh Verma', DATE: '2026-08-10',
    FATHER_NAME: 'Suresh Verma', VILLAGE: 'Shaharpura', ITEM_DETAIL: '5kg Flour, 2kg Sugar',
    YEAR: '2026', GENERATED_AT: new Date().toLocaleString('en-IN')
  };
  const PLACEHOLDER_HINTS = ['SAMAAN_NO', 'NAME', 'DATE', 'FATHER_NAME', 'VILLAGE', 'ITEM_DETAIL', 'YEAR', 'GENERATED_AT', 'QR_CODE'];

  const apiGroup = {
    list: () => api.getSamaanTemplates(),
    get: (year: string) => api.getSamaanTemplate(year),
    save: (year: string, text: string, pageSize: string) => api.saveSamaanTemplate(year, text, pageSize),
    copy: (fromYear: string, toYear: string) => api.copySamaanTemplate(fromYear, toYear),
    remove: (year: string) => api.deleteSamaanTemplate(year)
  };
</script>

<TemplateEditor
  heading="Material Templates"
  deleteLabel="Material template"
  samplePlaceholders={SAMPLE_PLACEHOLDERS}
  placeholderHints={PLACEHOLDER_HINTS}
  {apiGroup}
/>
