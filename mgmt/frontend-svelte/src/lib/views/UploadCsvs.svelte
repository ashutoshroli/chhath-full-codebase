<script lang="ts">
  // Ported from React views/UploadCsvs.jsx — bulk CSV import per section
  // (Users / Collections / Committee / Expenses): download sample or existing
  // data, upload+parse a CSV, validate headers, import, and show a report.
  import { api } from '$lib/api';

  interface SectionSpec {
    label: string;
    sheet: string;
    columns: string[];
    required: string[];
    notes: string[];
    sample: Record<string, string>[];
  }

  const SECTIONS: Record<string, SectionSpec> = {
    USERS: {
      label: 'Users (People)',
      sheet: 'USERS',
      columns: ['Name', 'Name (Hindi)', 'Village', 'Village (Hindi)', "Father's Name", "Father's Name (Hindi)", 'Mobile', 'Designation', 'Designation (Hindi)', 'Email', 'WhatsApp'],
      required: ['Name'],
      notes: [
        'One person per row. A USER#### id is assigned automatically — do NOT include an ID column.',
        'Mobile and WhatsApp, if present, must be exactly 10 digits.',
        "The (Hindi) columns are optional; leave them blank if you don't have them."
      ],
      sample: [
        { Name: 'Ramesh Kumar', 'Name (Hindi)': 'रमेश कुमार', Village: 'Shaharpura', 'Village (Hindi)': 'शहरपुरा', "Father's Name": 'Suresh Kumar', "Father's Name (Hindi)": 'सुरेश कुमार', Mobile: '9876543210', Designation: 'Member', 'Designation (Hindi)': 'सदस्य', Email: 'ramesh@example.com', WhatsApp: '9876543210' },
        { Name: 'Sita Devi', 'Name (Hindi)': 'सीता देवी', Village: 'Gardih', 'Village (Hindi)': 'गरडीह', "Father's Name": 'Mohan Lal', "Father's Name (Hindi)": 'मोहन लाल', Mobile: '9123456780', Designation: '', 'Designation (Hindi)': '', Email: '', WhatsApp: '' }
      ]
    },
    COLLECTIONS: {
      label: 'Collections (Contributions)',
      sheet: 'COLLECTIONS',
      columns: ['Year', 'Name', 'Amount', 'Payment Mode', 'Date', 'Contribution Type', 'Detail', 'Certificate Or Receipt', 'Is Resell'],
      required: ['Name', 'Amount'],
      notes: [
        "Name must be the person's existing USER#### id (or exact name) already in Users.",
        'Contribution Type: 1 = Cash (Money), 2 = Material (Saman), 3 = Service (Work). Default 1.',
        'Type 1 (Cash): Amount is required; Payment Mode = Cash / Online / UPI etc.',
        'Type 2 (Material): put the item(s) in Detail; Amount can be blank.',
        'Type 3 (Service/Work): put the work done in Detail; set Certificate Or Receipt to "Receipt" or "Certificate"; Amount can be blank.',
        'Resell item: set Is Resell = TRUE and put the item name in Detail. A resell row has NO person, so Name can be left blank; give the sale Amount.',
        'Year: the festival year (e.g. 2026). If the year is locked, those rows are skipped.'
      ],
      sample: [
        { Year: '2026', Name: 'USER0001', Amount: '1100', 'Payment Mode': 'Cash', Date: '2026-10-20', 'Contribution Type': '1', Detail: '', 'Certificate Or Receipt': '', 'Is Resell': 'FALSE' },
        { Year: '2026', Name: 'USER0002', Amount: '2100', 'Payment Mode': 'Online', Date: '2026-10-20', 'Contribution Type': '1', Detail: '', 'Certificate Or Receipt': '', 'Is Resell': 'FALSE' },
        { Year: '2026', Name: 'USER0003', Amount: '', 'Payment Mode': '', Date: '2026-10-21', 'Contribution Type': '2', Detail: '10 kg sugar + 5 L oil', 'Certificate Or Receipt': '', 'Is Resell': 'FALSE' },
        { Year: '2026', Name: 'USER0004', Amount: '', 'Payment Mode': '', Date: '2026-10-21', 'Contribution Type': '3', Detail: 'Managed the sound system', 'Certificate Or Receipt': 'Receipt', 'Is Resell': 'FALSE' },
        { Year: '2026', Name: 'USER0005', Amount: '', 'Payment Mode': '', Date: '2026-10-22', 'Contribution Type': '3', Detail: 'Priest services (puja)', 'Certificate Or Receipt': 'Certificate', 'Is Resell': 'FALSE' },
        { Year: '2026', Name: '', Amount: '500', 'Payment Mode': 'Cash', Date: '2026-10-25', 'Contribution Type': '1', Detail: 'Resold donated tent', 'Certificate Or Receipt': '', 'Is Resell': 'TRUE' }
      ]
    },
    'COMMITEE MEMBERS': {
      label: 'Committee Members',
      sheet: 'COMMITEE MEMBERS',
      columns: ['Year', 'Name', 'View Role', 'View Role (Hindi)', 'WhatsApp'],
      required: ['Name'],
      notes: [
        "Name must be the person's existing USER#### id (or exact name) already in Users.",
        'View Role is the committee designation shown publicly (e.g. President, Treasurer).',
        'WhatsApp, if present, must be exactly 10 digits.'
      ],
      sample: [
        { Year: '2026', Name: 'USER0001', 'View Role': 'President', 'View Role (Hindi)': 'अध्यक्ष', WhatsApp: '9876543210' },
        { Year: '2026', Name: 'USER0002', 'View Role': 'Treasurer', 'View Role (Hindi)': 'कोषाध्यक्ष', WhatsApp: '' }
      ]
    },
    EXPENSES: {
      label: 'Expenses',
      sheet: 'EXPENSES',
      columns: ['Year', 'Discription', 'Discription (Hindi)', 'Amount', 'Category'],
      required: ['Discription', 'Amount'],
      notes: [
        'Description column is spelled "Discription" (matching the system) — keep it exactly.',
        'Amount is required and must be a number.',
        'Category is optional (e.g. Prasad, Decoration, Sound, Tent).',
        'Year: the festival year (e.g. 2026). If the year is locked, those rows are skipped.'
      ],
      sample: [
        { Year: '2026', Discription: 'Tent and decoration', 'Discription (Hindi)': 'टेंट और सजावट', Amount: '15000', Category: 'Decoration' },
        { Year: '2026', Discription: 'Prasad distribution', 'Discription (Hindi)': 'प्रसाद वितरण', Amount: '8000', Category: 'Prasad' }
      ]
    }
  };

  const EXISTING_DATA: Record<string, { fetch: () => Promise<any>; rows: (res: any) => any[] }> = {
    USERS: { fetch: () => api.getUsers(), rows: (res) => (Array.isArray(res) ? res : (res && res.users) || []) },
    COLLECTIONS: { fetch: () => api.getHome('All'), rows: (res) => (res && res.collections) || [] },
    'COMMITEE MEMBERS': { fetch: () => api.getCommittee('All'), rows: (res) => (res && res.committee) || [] },
    EXPENSES: { fetch: () => api.getExpenses('All'), rows: (res) => (res && res.expenses) || [] }
  };

  function csvEscape(v: unknown): string {
    const s = v === undefined || v === null ? '' : v.toString();
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCsv(columns: string[], rows: any[]): string {
    const head = columns.map(csvEscape).join(',');
    const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\n');
    return head + '\n' + body + '\n';
  }
  function parseCsv(text: string): { headers: string[]; rows: any[] } {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const records: string[][] = [];
    let field = '';
    let record: string[] = [];
    let inQuotes = false;
    let i = 0;
    const pushField = () => { record.push(field); field = ''; };
    const pushRecord = () => { records.push(record); record = []; };
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { pushField(); i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { pushField(); pushRecord(); i++; continue; }
      field += ch; i++;
    }
    if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

    if (!records.length) return { headers: [], rows: [] };
    const headers = records[0].map((h) => h.trim());
    const rows = records.slice(1).map((cells) => {
      const obj: any = {};
      headers.forEach((h, idx) => { obj[h] = cells[idx] !== undefined ? cells[idx] : ''; });
      return obj;
    });
    return { headers, rows };
  }
  function downloadFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let sheet = $state('USERS');
  let fileName = $state('');
  let parsed = $state<{ headers: string[]; rows: any[] } | null>(null);
  let parseError = $state('');
  let uploading = $state(false);
  let report = $state<any>(null);
  let showInstructions = $state(false);
  let exporting = $state(false);
  let exportError = $state('');

  let spec = $derived(SECTIONS[sheet]);

  function reset() { parsed = null; parseError = ''; report = null; fileName = ''; exportError = ''; }
  function onPickSheet(val: string) { sheet = val; reset(); }

  function downloadSample() {
    downloadFile(`${spec.sheet.toLowerCase().replace(/\s+/g, '-')}-sample.csv`, toCsv(spec.columns, spec.sample));
  }

  async function downloadExisting() {
    exporting = true;
    exportError = '';
    try {
      const conf = EXISTING_DATA[sheet];
      const res = await conf.fetch();
      let rows = conf.rows(res) || [];

      let columns: string[];
      if (sheet === 'USERS') {
        columns = ['ID', ...spec.columns];
      } else if (sheet === 'COLLECTIONS' || sheet === 'COMMITEE MEMBERS') {
        const usersRes: any = await api.getUsers();
        const users = Array.isArray(usersRes) ? usersRes : (usersRes && usersRes.users) || [];
        const idByName: Record<string, string> = {};
        users.forEach((u: any) => { if (u.Name) idByName[u.Name.toString().trim()] = u.ID; });
        rows = rows.map((r: any) => ({ ...r, 'User ID': r.ID || idByName[(r.Name || '').toString().trim()] || '' }));
        columns = ['User ID', ...spec.columns];
      } else {
        columns = [...spec.columns];
      }

      if (!rows.length) {
        exportError = 'There is no existing data in this section yet.';
        return;
      }
      downloadFile(`${spec.sheet.toLowerCase().replace(/\s+/g, '-')}-existing.csv`, toCsv(columns, rows));
    } catch (err) {
      exportError = 'Could not download existing data: ' + ((err as Error).message || err);
    } finally {
      exporting = false;
    }
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    report = null;
    parseError = '';
    fileName = file.name;
    try {
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      if (!headers.length) { parseError = 'The file appears to be empty.'; parsed = null; input.value = ''; return; }
      const missing = spec.required.filter((r) => !headers.includes(r));
      if (missing.length) {
        parseError = `The CSV is missing required column(s): ${missing.join(', ')}. Download the sample to see the exact headers.`;
        parsed = null;
        input.value = '';
        return;
      }
      parsed = { headers, rows };
    } catch (err) {
      parseError = 'Could not read the file: ' + ((err as Error).message || err);
      parsed = null;
    }
    input.value = '';
  }

  async function doUpload() {
    if (!parsed || !parsed.rows.length) return;
    uploading = true;
    report = null;
    try {
      const res: any = await api.importCsvRows(spec.sheet, parsed.rows);
      report = res.report;
      parsed = null;
    } catch (err) {
      parseError = (err as Error).message || 'Import failed.';
    } finally {
      uploading = false;
    }
  }
</script>

<h2 style="margin-bottom:6px;">Upload CSVs</h2>
<p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:15px;">
  Bulk-import many rows at once from a spreadsheet. Each row is validated exactly
  like a manual entry, so nothing invalid gets in. Pick a section, download the
  sample to see the exact columns, fill it, then upload.
</p>

<div class="subtabs" style="margin-bottom:15px;">
  {#each Object.keys(SECTIONS) as key (key)}
    <button class="subtab-btn {sheet === key ? 'active' : ''}" onclick={() => onPickSheet(key)}>
      {SECTIONS[key].label}
    </button>
  {/each}
</div>

<div class="glass-card" style="padding:15px; margin-bottom:15px;">
  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
    <strong>{spec.label} — CSV</strong>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button class="btn-submit" style="width:auto; text-align:center;" onclick={downloadSample}>⬇ Download Sample</button>
      <button class="btn-submit" style="width:auto; text-align:center; background:#0f766e;" disabled={exporting} onclick={downloadExisting}>
        {exporting ? 'Preparing…' : '⬇ Download Existing Data'}
      </button>
    </div>
  </div>
  <p style="font-size:0.8rem; color:var(--text-muted); margin:8px 0 0;">
    <strong>Sample</strong> shows the exact columns to fill. <strong>Existing Data</strong> exports what's
    already in the system (with each person's User ID) — edit it and re-upload to make changes in bulk.
    Keep the header row exactly as-is, then upload below.
  </p>
  {#if exportError}<div class="error-banner" style="margin-top:8px;">{exportError}</div>{/if}

  <div style="font-size:0.8rem; color:#1E40AF; background:#DBEAFE; border-radius:6px; padding:6px 10px; margin:8px 0 0;">
    ℹ️ <strong>Columns:</strong> {spec.columns.join(', ')}
    <br />
    <strong>Required:</strong> {spec.required.join(', ')}
  </div>

  <button type="button" class="btn-submit" style="width:auto; margin-top:10px; background:#e5e7eb; color:#111;" onclick={() => (showInstructions = !showInstructions)}>
    {showInstructions ? 'Hide Instructions' : '📖 How to prepare the CSV'}
  </button>
  {#if showInstructions}
    <div style="background:#f9fafb; border-radius:8px; padding:15px; margin-top:12px; font-size:0.85rem; line-height:1.6;">
      <p><strong>1. Header row:</strong> the first row must be the column names, spelled exactly as in the sample (case and spaces matter).</p>
      <p><strong>2. One record per row.</strong> Extra columns you don't need can be left blank; extra columns the app doesn't know about are ignored.</p>
      <p><strong>3. Commas inside a value:</strong> wrap that value in double quotes, e.g. <code>"Kumar, S."</code> — Excel/Sheets do this automatically on export.</p>
      <p><strong>4. Save/Export as CSV</strong> (UTF-8). Hindi text is fully supported.</p>
      {#each spec.notes as n, i (i)}<p><strong>{i + 5}.</strong> {n}</p>{/each}
      <p style="color:var(--danger);"><strong>Note:</strong> Loans are NOT importable here — a loan needs its 3 guarantors and the consent flow, so it must be created on the Loans screen.</p>
    </div>
  {/if}
</div>

<div class="glass-card" style="padding:15px; margin-bottom:15px;">
  <label style="display:block; font-weight:600; margin-bottom:8px;">Upload {spec.label} CSV</label>
  <input type="file" accept=".csv,text/csv" onchange={onFile} />
  {#if fileName}<div style="font-size:0.8rem; color:var(--text-muted); margin-top:6px;">Selected: {fileName}</div>{/if}

  {#if parseError}<div class="error-banner" style="margin-top:10px;">{parseError}</div>{/if}

  {#if parsed}
    <div style="margin-top:12px;">
      <div style="font-size:0.85rem; margin-bottom:10px;">
        <strong>{parsed.rows.length}</strong> row{parsed.rows.length === 1 ? '' : 's'} found. Review, then import.
      </div>
      <button class="btn-submit" style="width:auto;" disabled={uploading} onclick={doUpload}>
        {uploading ? 'Importing…' : `Import ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}`}
      </button>
    </div>
  {/if}
</div>

{#if report}
  <div class="glass-card" style="padding:15px;">
    <h3 style="margin-bottom:10px;">Import Report — {report.label}</h3>
    <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
      <div style="background:#eff6ff; color:#1d4ed8; border-radius:10px; padding:10px 16px; text-align:center; min-width:90px;">
        <div style="font-size:1.4rem; font-weight:700;">{report.total}</div>
        <div style="font-size:0.78rem;">Rows in file</div>
      </div>
      <div style="background:#f0fdf4; color:#16a34a; border-radius:10px; padding:10px 16px; text-align:center; min-width:90px;">
        <div style="font-size:1.4rem; font-weight:700;">{report.imported}</div>
        <div style="font-size:0.78rem;">Imported</div>
      </div>
      <div style="background:#fef2f2; color:#b91c1c; border-radius:10px; padding:10px 16px; text-align:center; min-width:90px;">
        <div style="font-size:1.4rem; font-weight:700;">{report.skipped}</div>
        <div style="font-size:0.78rem;">Skipped</div>
      </div>
    </div>

    {#if report.failures && report.failures.length > 0}
      <div style="font-size:0.85rem; font-weight:600; margin-bottom:6px;">Skipped rows &amp; reasons</div>
      <div style="overflow-x:auto;">
        <table style="width:100%; min-width:420px; border-collapse:collapse; font-size:0.82rem;">
          <thead>
            <tr style="text-align:left; color:var(--text-muted);">
              <th style="padding:6px 10px; white-space:nowrap;">Row #</th>
              <th style="padding:6px 10px; white-space:nowrap;">Name</th>
              <th style="padding:6px 10px;">Reason</th>
            </tr>
          </thead>
          <tbody>
            {#each report.failures as f, i (i)}
              <tr style="border-top:1px solid #f0f0f0;">
                <td style="padding:6px 10px; white-space:nowrap;">{f.row}</td>
                <td style="padding:6px 10px; white-space:nowrap;">{f.name || '—'}</td>
                <td style="padding:6px 10px; color:#b91c1c;">{f.reason}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p style="font-size:0.8rem; color:var(--text-muted); margin-top:10px;">
        The {report.imported} valid row{report.imported === 1 ? ' was' : 's were'} imported. Fix the rows above in your
        CSV and upload just those again — already-imported rows are not affected.
      </p>
    {:else}
      <div style="background:#DCFCE7; color:#166534; border-radius:8px; padding:10px 12px; font-size:0.9rem;">
        ✅ All {report.imported} row{report.imported === 1 ? '' : 's'} imported successfully.
      </div>
    {/if}
  </div>
{/if}
