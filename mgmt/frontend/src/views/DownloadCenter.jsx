import { useState } from 'react';
import { api, reportClientError } from '../api.js';
import { fillDocxTemplateFromRow, getLastRenderReport } from '../docxFill.js';
import { generateQrDataUrl, publicRecordUrl } from '../qrCode.js';
import { useDropdownList } from '../useDropdownList.js';

function DownloadItem({ item, onGenerated, canGenerate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const generate = async () => {
    setBusy(true);
    setError('');
    setWarning('');
    try {
      let templateRow;
      try {
        templateRow = await api.getDocxTemplateForDoc(item.docType, item.year);
      } catch (err) {
        // Was `.catch(() => null)`, which turned a genuine load failure into the
        // misleading "no template exists — upload one" message.
        reportClientError('DownloadCenter', `Template load failed for ${item.docType} ${item.year}`, err,
          { docType: item.docType, year: item.year, recordId: item.recordId });
        setError(`Template load nahi hua: ${err.message}`);
        return;
      }
      if (!templateRow || (!templateRow.base64 && !templateRow.downloadUrl)) {
        setError('No .docx template exists for this year/type (upload one in the Document Templates tab).');
        return;
      }

      let qrCode = '';
      try {
        qrCode = await generateQrDataUrl(publicRecordUrl(item.recordId));
      } catch (qrErr) {
        setWarning('QR generate nahi hua — PDF ka QR blank rahega.');
        reportClientError('DownloadCenter', `QR generation failed for ${item.recordId}`, qrErr,
          { docType: item.docType, year: item.year, recordId: item.recordId });
      }

      const filledBase64 = await fillDocxTemplateFromRow(templateRow, { ...item.placeholders, GENERATED_AT: new Date().toLocaleString('en-IN'), QR_CODE: qrCode });

      const rep = getLastRenderReport();
      if (rep.missingTags.length) {
        setWarning(`Blank placeholders: ${[...new Set(rep.missingTags)].join(', ')}`);
        reportClientError('DownloadCenter', `Unresolved placeholders for ${item.recordId}`, null,
          { docType: item.docType, year: item.year, recordId: item.recordId, missingTags: [...new Set(rep.missingTags)] });
      }

      const fileName = `${item.fileNameHint}.docx`;
      const res = await api.convertDocxToPdf(item.docType, item.year, item.recordId, filledBase64, fileName, 'bulk');

      // indexFailed was returned by the backend and ignored here, so the file
      // looked generated while the public portal would show "Not Available".
      if (res && res.indexFailed) {
        setWarning(res.error || 'PDF ban gaya lekin public portal mein index nahi hua.');
        reportClientError('DownloadCenter', `PDF generated but NOT indexed: ${item.recordId}`, null,
          { docType: item.docType, year: item.year, recordId: item.recordId, publicLink: res.publicLink });
      }

      onGenerated(item.recordId, res.publicLink);
    } catch (err) {
      setError(err.message);
      reportClientError('DownloadCenter', `Generate failed for ${item.recordId}`, err,
        { docType: item.docType, year: item.year, recordId: item.recordId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: '0.9rem' }}>{item.label}</div>
        {error && <div style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{error}</div>}
        {warning && <div style={{ fontSize: '0.75rem', color: '#92400E' }}>⚠️ {warning}</div>}
      </div>
      {item.publicLink ? (
        <a href={item.publicLink} target="_blank" rel="noreferrer" className="btn-submit" style={{ width: 'auto', padding: '6px 14px', fontSize: '0.85rem', textDecoration: 'none', textAlign: 'center' }}>
          ⬇ Download
        </a>
      ) : canGenerate ? (
        <button className="btn-submit" style={{ width: 'auto', padding: '6px 14px', fontSize: '0.85rem', background: '#e5e7eb', color: '#111' }} onClick={generate} disabled={busy}>
          {busy ? 'Generating...' : 'Generate Now'}
        </button>
      ) : (
        <span className="badge" style={{ background: '#f3f4f6', color: 'var(--text-muted)' }}>Not Available</span>
      )}
    </div>
  );
}

function Section({ title, items, onGenerated, canGenerate }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
      <strong>{title}</strong>
      <div style={{ marginTop: 8 }}>
        {items.map(item => <DownloadItem key={item.recordId} item={item} onGenerated={onGenerated} canGenerate={canGenerate} />)}
      </div>
    </div>
  );
}

export default function DownloadCenter({ role }) {
  const canGenerate = role === 'Superadmin';
  const { options: villages } = useDropdownList('Village');
  const [village, setVillage] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [downloads, setDownloads] = useState(null);
  const [loadingDownloads, setLoadingDownloads] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    if (!village) return alert('Please select a village first');
    setSearching(true);
    setError('');
    setSelected(null);
    setDownloads(null);
    try {
      const res = await api.searchUsersByVillageAndName(village, nameQuery);
      setResults(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const selectUser = async (u) => {
    setSelected(u);
    setLoadingDownloads(true);
    setError('');
    try {
      const res = await api.getPersonDownloads(u.ID);
      setDownloads(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingDownloads(false);
    }
  };

  const markGenerated = (recordId, publicLink) => {
    setDownloads(d => {
      if (!d) return d;
      const patch = (arr) => arr.map(item => item.recordId === recordId ? { ...item, publicLink } : item);
      return { ...d, collections: patch(d.collections), loanerItems: patch(d.loanerItems), guarantorItems: patch(d.guarantorItems) };
    });
  };

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Download Center</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
        <div className="form-group">
          <label>Village</label>
          <select value={village} onChange={e => { setVillage(e.target.value); setResults(null); setSelected(null); setDownloads(null); }}>
            <option value="">-- Select Village --</option>
            {villages.map(v => <option key={v['English Value']} value={v['English Value']}>{v['English Value']}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Name / Mobile / ID</label>
          <input value={nameQuery} onChange={e => setNameQuery(e.target.value)} placeholder="Search..." disabled={!village} />
        </div>
        <button className="btn-submit" onClick={search} disabled={searching || !village}>{searching ? 'Searching...' : 'Search'}</button>
      </div>

      {results && !selected && (
        <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
          {results.length === 0 && <div style={{ textAlign: 'center', padding: 10 }}>No matches found.</div>}
          {results.map(u => (
            <div
              key={u.ID}
              onClick={() => selectUser(u)}
              style={{ padding: '10px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
            >
              <strong>{u.Name}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.Village} {u.Mobile ? `| ${u.Mobile}` : ''}</div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong>{selected.Name} ({selected.Village})</strong>
            <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={() => { setSelected(null); setDownloads(null); }}>
              ← Back
            </button>
          </div>

          {loadingDownloads && <div className="inline-spinner">Loading...</div>}

          {downloads && (
            <>
              <Section title="Receipts / Certificates / Material" items={downloads.collections} onGenerated={markGenerated} canGenerate={canGenerate} />
              <Section title="Loan Consent (Loaner)" items={downloads.loanerItems} onGenerated={markGenerated} canGenerate={canGenerate} />
              <Section title="Loan Consent (Guarantor)" items={downloads.guarantorItems} onGenerated={markGenerated} canGenerate={canGenerate} />
              {downloads.collections.length === 0 && downloads.loanerItems.length === 0 && downloads.guarantorItems.length === 0 && (
                <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No downloadable records available for this person.</div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
