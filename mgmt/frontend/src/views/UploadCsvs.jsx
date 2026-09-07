import { useState } from 'react';
import { api } from '../api.js';

// Superadmin-only: bulk-import rows from a CSV for the ordinary data sections.
// Each row is sent to the backend importCsvRows action, which runs it through the
// SAME saveRecord validation/id-allocation as a manual add — so a CSV can never
// create a row a manual add couldn't. Loans are intentionally NOT here (a loan
// needs the full 3-guarantor + consent flow — see the note in the UI).

// The sections that can be imported. `columns` are the CSV headers; `required`
// mirror the backend's REQUIRED_FIELDS; `sample` rows generate a downloadable
// example. Header names match the backend exactly (do not rename).
const SECTIONS = {
  USERS: {
    label: 'Users (People)',
    sheet: 'USERS',
    columns: ['Name', 'Name (Hindi)', 'Village', 'Village (Hindi)', "Father's Name", "Father's Name (Hindi)", 'Mobile', 'Designation', 'Designation (Hindi)', 'Email', 'WhatsApp'],
    required: ['Name'],
    notes: [
      'One person per row. A USER#### id is assigned automatically — do NOT include an ID column.',
      'Mobile and WhatsApp, if present, must be exactly 10 digits.',
      'The (Hindi) columns are optional; leave them blank if you don\'t have them.',
    ],
    sample: [
      { Name: 'Ramesh Kumar', 'Name (Hindi)': 'रमेश कुमार', Village: 'Shaharpura', 'Village (Hindi)': 'शहरपुरा', "Father's Name": 'Suresh Kumar', "Father's Name (Hindi)": 'सुरेश कुमार', Mobile: '9876543210', Designation: 'Member', 'Designation (Hindi)': 'सदस्य', Email: 'ramesh@example.com', WhatsApp: '9876543210' },
      { Name: 'Sita Devi', 'Name (Hindi)': 'सीता देवी', Village: 'Gardih', 'Village (Hindi)': 'गरडीह', "Father's Name": 'Mohan Lal', "Father's Name (Hindi)": 'मोहन लाल', Mobile: '9123456780', Designation: '', 'Designation (Hindi)': '', Email: '', WhatsApp: '' },
    ],
  },
  COLLECTIONS: {
    label: 'Collections (Contributions)',
    sheet: 'COLLECTIONS',
    columns: ['Year', 'Name', 'Amount', 'Payment Mode', 'Date', 'Contribution Type', 'Detail', 'Certificate Or Receipt', 'Is Resell'],
    required: ['Name', 'Amount'],
    notes: [
      'Name must be the person\'s existing USER#### id (or exact name) already in Users.',
      'Contribution Type: 1 = Cash (Money), 2 = Material (Saman), 3 = Service (Work). Default 1.',
      'Type 1 (Cash): Amount is required; Payment Mode = Cash / Online / UPI etc.',
      'Type 2 (Material): put the item(s) in Detail; Amount can be blank.',
      'Type 3 (Service/Work): put the work done in Detail; set Certificate Or Receipt to "Receipt" or "Certificate"; Amount can be blank.',
      'Resell item: set Is Resell = TRUE and put the item name in Detail. A resell row has NO person, so Name can be left blank; give the sale Amount.',
      'Year: the festival year (e.g. 2026). If the year is locked, those rows are skipped.',
    ],
    // Covers all types: 1 (Cash), 2 (Material), 3 (Service — Receipt),
    // 3 (Service — Certificate), and a Resell item.
    sample: [
      { Year: '2026', Name: 'USER0001', Amount: '1100', 'Payment Mode': 'Cash', Date: '2026-10-20', 'Contribution Type': '1', Detail: '', 'Certificate Or Receipt': '', 'Is Resell': 'FALSE' },
      { Year: '2026', Name: 'USER0002', Amount: '2100', 'Payment Mode': 'Online', Date: '2026-10-20', 'Contribution Type': '1', Detail: '', 'Certificate Or Receipt': '', 'Is Resell': 'FALSE' },
      { Year: '2026', Name: 'USER0003', Amount: '', 'Payment Mode': '', Date: '2026-10-21', 'Contribution Type': '2', Detail: '10 kg sugar + 5 L oil', 'Certificate Or Receipt': '', 'Is Resell': 'FALSE' },
      { Year: '2026', Name: 'USER0004', Amount: '', 'Payment Mode': '', Date: '2026-10-21', 'Contribution Type': '3', Detail: 'Managed the sound system', 'Certificate Or Receipt': 'Receipt', 'Is Resell': 'FALSE' },
      { Year: '2026', Name: 'USER0005', Amount: '', 'Payment Mode': '', Date: '2026-10-22', 'Contribution Type': '3', Detail: 'Priest services (puja)', 'Certificate Or Receipt': 'Certificate', 'Is Resell': 'FALSE' },
      { Year: '2026', Name: '', Amount: '500', 'Payment Mode': 'Cash', Date: '2026-10-25', 'Contribution Type': '1', Detail: 'Resold donated tent', 'Certificate Or Receipt': '', 'Is Resell': 'TRUE' },
    ],
  },
  'COMMITEE MEMBERS': {
    label: 'Committee Members',
    sheet: 'COMMITEE MEMBERS',
    columns: ['Year', 'Name', 'View Role', 'View Role (Hindi)', 'WhatsApp'],
    required: ['Name'],
    notes: [
      'Name must be the person\'s existing USER#### id (or exact name) already in Users.',
      'View Role is the committee designation shown publicly (e.g. President, Treasurer).',
      'WhatsApp, if present, must be exactly 10 digits.',
    ],
    sample: [
      { Year: '2026', Name: 'USER0001', 'View Role': 'President', 'View Role (Hindi)': 'अध्यक्ष', WhatsApp: '9876543210' },
      { Year: '2026', Name: 'USER0002', 'View Role': 'Treasurer', 'View Role (Hindi)': 'कोषाध्यक्ष', WhatsApp: '' },
    ],
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
      'Year: the festival year (e.g. 2026). If the year is locked, those rows are skipped.',
    ],
    sample: [
      { Year: '2026', Discription: 'Tent and decoration', 'Discription (Hindi)': 'टेंट और सजावट', Amount: '15000', Category: 'Decoration' },
      { Year: '2026', Discription: 'Prasad distribution', 'Discription (Hindi)': 'प्रसाद वितरण', Amount: '8000', Category: 'Prasad' },
    ],
  },
};

// Which read API returns the existing rows for each section, and how to pull the
// array out of its response, for the "Download existing data" export.
const EXISTING_DATA = {
  USERS: { fetch: () => api.getUsers(), rows: (res) => (Array.isArray(res) ? res : (res && res.users) || []) },
  COLLECTIONS: { fetch: () => api.getHome('All'), rows: (res) => (res && res.collections) || [] },
  'COMMITEE MEMBERS': { fetch: () => api.getCommittee('All'), rows: (res) => (res && res.committee) || [] },
  EXPENSES: { fetch: () => api.getExpenses('All'), rows: (res) => (res && res.expenses) || [] },
};

// ---- CSV helpers ----------------------------------------------------------

// Escape one field for CSV output: wrap in quotes if it contains a comma, quote,
// or newline; double any embedded quotes.
function csvEscape(v) {
  const s = (v === undefined || v === null) ? '' : v.toString();
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const head = columns.map(csvEscape).join(',');
  const body = rows.map(r => columns.map(c => csvEscape(r[c])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

// A small, correct CSV parser: handles quoted fields, embedded commas/newlines,
// and doubled quotes ("" -> "). Returns { headers, rows } where rows are objects
// keyed by header. Blank lines become empty rows (the backend skips them).
function parseCsv(text) {
  // Strip a UTF-8 BOM if present (Excel adds one).
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const records = [];
  let field = '';
  let record = [];
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
    if (ch === '\r') { i++; continue; } // ignore CR; handle LF below
    if (ch === '\n') { pushField(); pushRecord(); i++; continue; }
    field += ch; i++;
  }
  // Flush the last field/record if the file didn't end with a newline.
  if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map(h => h.trim());
  const rows = records.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] !== undefined ? cells[idx] : ''); });
    return obj;
  });
  return { headers, rows };
}

function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
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

// ---------------------------------------------------------------------------

export default function UploadCsvs() {
  const [sheet, setSheet] = useState('USERS');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null); // { headers, rows }
  const [parseError, setParseError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const spec = SECTIONS[sheet];

  const reset = () => { setParsed(null); setParseError(''); setReport(null); setFileName(''); setExportError(''); };

  const onPickSheet = (val) => { setSheet(val); reset(); };

  const downloadSample = () => {
    downloadFile(`${spec.sheet.toLowerCase().replace(/\s+/g, '-')}-sample.csv`, toCsv(spec.columns, spec.sample));
  };

  // Download the EXISTING rows of this section as a CSV — including each person's
  // User ID — so a Superadmin can see what's already in the system, edit it, and
  // (for the importable columns) re-upload. USERS get their own ID column; rows
  // that reference a person (Collections/Committee) get an extra "User ID" column
  // resolved from the Users list. The file uses the same header names as the
  // sample so it round-trips into the importer.
  const downloadExisting = async () => {
    setExporting(true);
    setExportError('');
    try {
      const conf = EXISTING_DATA[sheet];
      const res = await conf.fetch();
      let rows = conf.rows(res) || [];

      // Build the export columns: the importable columns, but ALWAYS surface an
      // id so the export identifies each record.
      let columns;
      if (sheet === 'USERS') {
        columns = ['ID', ...spec.columns]; // the person's own USER#### id
      } else if (sheet === 'COLLECTIONS' || sheet === 'COMMITEE MEMBERS') {
        // These reference a person by Name; add the resolved User ID beside it.
        // Fetch the users list once to map name -> id_code.
        const usersRes = await api.getUsers();
        const users = Array.isArray(usersRes) ? usersRes : (usersRes && usersRes.users) || [];
        const idByName = {};
        users.forEach(u => { if (u.Name) idByName[u.Name.toString().trim()] = u.ID; });
        rows = rows.map(r => ({ ...r, 'User ID': r.ID || idByName[(r.Name || '').toString().trim()] || '' }));
        columns = ['User ID', ...spec.columns];
      } else {
        columns = [...spec.columns]; // EXPENSES — no person reference
      }

      if (!rows.length) {
        setExportError('There is no existing data in this section yet.');
        return;
      }
      downloadFile(`${spec.sheet.toLowerCase().replace(/\s+/g, '-')}-existing.csv`, toCsv(columns, rows));
    } catch (err) {
      setExportError('Could not download existing data: ' + (err.message || err));
    } finally {
      setExporting(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setReport(null);
    setParseError('');
    setFileName(file.name);
    try {
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      if (!headers.length) { setParseError('The file appears to be empty.'); setParsed(null); return; }
      // Warn (don't block) if a required column is missing from the header.
      const missing = spec.required.filter(r => !headers.includes(r));
      if (missing.length) {
        setParseError(`The CSV is missing required column(s): ${missing.join(', ')}. Download the sample to see the exact headers.`);
        setParsed(null);
        return;
      }
      setParsed({ headers, rows });
    } catch (err) {
      setParseError('Could not read the file: ' + (err.message || err));
      setParsed(null);
    }
    // Allow re-selecting the same file later.
    e.target.value = '';
  };

  const doUpload = async () => {
    if (!parsed || !parsed.rows.length) return;
    setUploading(true);
    setReport(null);
    try {
      const res = await api.importCsvRows(spec.sheet, parsed.rows);
      setReport(res.report);
      setParsed(null);
    } catch (err) {
      setParseError(err.message || 'Import failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <h2 style={{ marginBottom: 6 }}>Upload CSVs</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 15 }}>
        Bulk-import many rows at once from a spreadsheet. Each row is validated exactly
        like a manual entry, so nothing invalid gets in. Pick a section, download the
        sample to see the exact columns, fill it, then upload.
      </p>

      {/* Section selector */}
      <div className="subtabs" style={{ marginBottom: 15 }}>
        {Object.keys(SECTIONS).map(key => (
          <button key={key} className={`subtab-btn ${sheet === key ? 'active' : ''}`} onClick={() => onPickSheet(key)}>
            {SECTIONS[key].label}
          </button>
        ))}
      </div>

      {/* Sample + instructions */}
      <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <strong>{spec.label} — CSV</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-submit" style={{ width: 'auto', textAlign: 'center' }} onClick={downloadSample}>
              ⬇ Download Sample
            </button>
            <button className="btn-submit" style={{ width: 'auto', textAlign: 'center', background: '#0f766e' }} disabled={exporting} onClick={downloadExisting}>
              {exporting ? 'Preparing…' : '⬇ Download Existing Data'}
            </button>
          </div>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '8px 0 0' }}>
          <strong>Sample</strong> shows the exact columns to fill. <strong>Existing Data</strong> exports what's
          already in the system (with each person's User ID) — edit it and re-upload to make changes in bulk.
          Keep the header row exactly as-is, then upload below.
        </p>
        {exportError && <div className="error-banner" style={{ marginTop: 8 }}>{exportError}</div>}

        <div style={{ fontSize: '0.8rem', color: '#1E40AF', background: '#DBEAFE', borderRadius: 6, padding: '6px 10px', margin: '8px 0 0' }}>
          ℹ️ <strong>Columns:</strong> {spec.columns.join(', ')}
          <br />
          <strong>Required:</strong> {spec.required.join(', ')}
        </div>

        <button type="button" className="btn-submit" style={{ width: 'auto', marginTop: 10, background: '#e5e7eb', color: '#111' }} onClick={() => setShowInstructions(v => !v)}>
          {showInstructions ? 'Hide Instructions' : '📖 How to prepare the CSV'}
        </button>
        {showInstructions && (
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: 15, marginTop: 12, fontSize: '0.85rem', lineHeight: 1.6 }}>
            <p><strong>1. Header row:</strong> the first row must be the column names, spelled exactly as in the sample (case and spaces matter).</p>
            <p><strong>2. One record per row.</strong> Extra columns you don't need can be left blank; extra columns the app doesn't know about are ignored.</p>
            <p><strong>3. Commas inside a value:</strong> wrap that value in double quotes, e.g. <code>"Kumar, S."</code> — Excel/Sheets do this automatically on export.</p>
            <p><strong>4. Save/Export as CSV</strong> (UTF-8). Hindi text is fully supported.</p>
            {spec.notes.map((n, i) => <p key={i}><strong>{i + 5}.</strong> {n}</p>)}
            <p style={{ color: 'var(--danger)' }}><strong>Note:</strong> Loans are NOT importable here — a loan needs its 3 guarantors and the consent flow, so it must be created on the Loans screen.</p>
          </div>
        )}
      </div>

      {/* Upload */}
      <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Upload {spec.label} CSV</label>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
        {fileName && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>Selected: {fileName}</div>}

        {parseError && <div className="error-banner" style={{ marginTop: 10 }}>{parseError}</div>}

        {parsed && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: '0.85rem', marginBottom: 10 }}>
              <strong>{parsed.rows.length}</strong> row{parsed.rows.length === 1 ? '' : 's'} found. Review, then import.
            </div>
            <button className="btn-submit" style={{ width: 'auto' }} disabled={uploading} onClick={doUpload}>
              {uploading ? 'Importing…' : `Import ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>

      {/* Report */}
      {report && (
        <div className="glass-card" style={{ padding: 15 }}>
          <h3 style={{ marginBottom: 10 }}>Import Report — {report.label}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <div style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 10, padding: '10px 16px', textAlign: 'center', minWidth: 90 }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{report.total}</div>
              <div style={{ fontSize: '0.78rem' }}>Rows in file</div>
            </div>
            <div style={{ background: '#f0fdf4', color: '#16a34a', borderRadius: 10, padding: '10px 16px', textAlign: 'center', minWidth: 90 }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{report.imported}</div>
              <div style={{ fontSize: '0.78rem' }}>Imported</div>
            </div>
            <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 10, padding: '10px 16px', textAlign: 'center', minWidth: 90 }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{report.skipped}</div>
              <div style={{ fontSize: '0.78rem' }}>Skipped</div>
            </div>
          </div>

          {report.failures && report.failures.length > 0 ? (
            <>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>Skipped rows &amp; reasons</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>Row #</th>
                      <th style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>Name</th>
                      <th style={{ padding: '6px 10px' }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.failures.map((f, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{f.row}</td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{f.name || '—'}</td>
                        <td style={{ padding: '6px 10px', color: '#b91c1c' }}>{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 10 }}>
                The {report.imported} valid row{report.imported === 1 ? ' was' : 's were'} imported. Fix the rows above in your
                CSV and upload just those again — already-imported rows are not affected.
              </p>
            </>
          ) : (
            <div style={{ background: '#DCFCE7', color: '#166534', borderRadius: 8, padding: '10px 12px', fontSize: '0.9rem' }}>
              ✅ All {report.imported} row{report.imported === 1 ? '' : 's'} imported successfully.
            </div>
          )}
        </div>
      )}
    </>
  );
}
