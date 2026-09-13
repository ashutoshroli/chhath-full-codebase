<script lang="ts">
  // Ported from React views/CertificateTemplates.jsx — thin wrapper over the
  // shared TemplateEditor with certificate-specific config.
  import { api } from '$lib/api';
  import TemplateEditor from '$lib/components/TemplateEditor.svelte';

  const SAMPLE_PLACEHOLDERS = {
    CERT_NO: 'NCS-CERT-2026-1', NAME: 'Ramesh Verma', DATE: '2026-08-10', YEAR: '2026',
    FATHER_NAME: 'Suresh Verma', VILLAGE: 'Shaharpura', DESIGNATION: '',
    DETAIL: 'Mandap decoration and cleaning arrangements', GENERATED_AT: new Date().toLocaleString('en-IN')
  };
  const PLACEHOLDER_HINTS = ['CERT_NO', 'NAME', 'DATE', 'YEAR', 'FATHER_NAME', 'VILLAGE', 'DESIGNATION', 'DETAIL', 'GENERATED_AT', 'QR_CODE'];

  const apiGroup = {
    list: () => api.getCertificateTemplates(),
    get: (year: string) => api.getCertificateTemplate(year),
    save: (year: string, text: string, pageSize: string) => api.saveCertificateTemplate(year, text, pageSize),
    copy: (fromYear: string, toYear: string) => api.copyCertificateTemplate(fromYear, toYear),
    remove: (year: string) => api.deleteCertificateTemplate(year)
  };
</script>

<TemplateEditor
  heading="Certificate Templates"
  deleteLabel="certificate template"
  samplePlaceholders={SAMPLE_PLACEHOLDERS}
  placeholderHints={PLACEHOLDER_HINTS}
  {apiGroup}
/>
