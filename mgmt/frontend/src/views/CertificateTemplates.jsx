import { useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../api.js';
import { renderReceiptTemplate, PAGE_SIZES_MM } from '../receiptTemplate.js';
import { generateQrDataUrl, publicRecordUrl } from '../qrCode.js';

const SAMPLE_PLACEHOLDERS = {
  CERT_NO: 'NCS-CERT-2026-1', NAME: 'Ramesh Verma', DATE: '2026-08-10', YEAR: '2026',
  FATHER_NAME: 'Suresh Verma', VILLAGE: 'Shaharpura', DESIGNATION: '',
  DETAIL: 'Mandap decoration and cleaning arrangements', GENERATED_AT: new Date().toLocaleString('en-IN'),
};

const PLACEHOLDER_HINTS = ['CERT_NO', 'NAME', 'DATE', 'YEAR', 'FATHER_NAME', 'VILLAGE', 'DESIGNATION', 'DETAIL', 'GENERATED_AT', 'QR_CODE'];

export default function CertificateTemplates() {
  const [templates, setTemplates] = useState([]);
  const [year, setYear] = useState(null);
  const [text, setText] = useState('');
  const [pageSize, setPageSize] = useState('A5');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [newYear, setNewYear] = useState('');
  const [copyTarget, setCopyTarget] = useState('');
  const [showCopy, setShowCopy] = useState(false);
  const [sampleQr, setSampleQr] = useState('');

  useEffect(() => {
    // Deliberately silent: this QR is only a decorative THUMBNAIL shown next to the
    // placeholder hints in this editor (record id "sample-preview"). It never ends
    // up in a generated document, so a failure here has no consequence worth
    // reporting. The QR used in real documents is generated in ReceiptModal /
    // Home / Bulk / DownloadCenter / ConsentPage, and every one of those DOES
    // report a failure now.
    generateQrDataUrl(publicRecordUrl('sample-preview')).then(setSampleQr).catch(() => {});
  }, []);

  const refreshList = () => {
    api.getCertificateTemplates().then(list => {
      setTemplates(list);
      if (list.length && year === null) setYear(list[0].Year);
    }).catch(err => setError(err.message));
  };

  useEffect(() => { refreshList(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (year === null) { setLoading(false); return; }
    setLoading(true);
    setError('');
    api.getCertificateTemplate(year).then(row => {
      setText(row ? row['Template Text'] : '');
      setPageSize(row ? row['Page Size'] : 'A5');
    }).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [year]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.saveCertificateTemplate(year, text, pageSize);
      refreshList();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const createNew = async () => {
    if (!newYear) return;
    setSaving(true);
    setError('');
    try {
      await api.saveCertificateTemplate(newYear, text || '', 'A5');
      setYear(parseInt(newYear));
      setNewYear('');
      refreshList();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const doCopy = async () => {
    if (!copyTarget) return;
    setSaving(true);
    setError('');
    try {
      await api.copyCertificateTemplate(year, copyTarget);
      setYear(parseInt(copyTarget));
      setCopyTarget('');
      setShowCopy(false);
      refreshList();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the certificate template for Year ${year}?`)) return;
    try {
      await api.deleteCertificateTemplate(year);
      setYear(null);
      refreshList();
    } catch (err) {
      setError(err.message);
    }
  };

  const previewHtml = preview ? DOMPurify.sanitize(marked.parse(renderReceiptTemplate(text, { ...SAMPLE_PLACEHOLDERS, QR_CODE: sampleQr }))) : '';
  const size = PAGE_SIZES_MM[pageSize] || PAGE_SIZES_MM.A5;

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Certificate Templates</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {templates.map(t => (
            <button key={t.Year} className={`nav-btn ${year === t.Year ? 'active' : ''}`} onClick={() => setYear(t.Year)}>{t.Year}</button>
          ))}
          <button className="nav-btn" onClick={() => setShowCopy(v => !v)} disabled={!year}>Copy as New Year</button>
        </div>

        {showCopy && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <input placeholder="New year (e.g. 2027)" type="number" value={copyTarget} onChange={e => setCopyTarget(e.target.value)} style={{ maxWidth: 160 }} />
            <button className="btn-submit" style={{ width: 'auto' }} onClick={doCopy} disabled={saving || !copyTarget}>Copy</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Add new year" type="number" value={newYear} onChange={e => setNewYear(e.target.value)} style={{ maxWidth: 160 }} />
          <button className="btn-submit" style={{ width: 'auto' }} onClick={createNew} disabled={saving || !newYear}>+ Add</button>
        </div>
      </div>

      {year !== null && (
        <div className="glass-card" style={{ padding: 15 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <strong>Year {year}</strong>
            <div className="form-group" style={{ margin: 0 }}>
              <select value={pageSize} onChange={e => setPageSize(e.target.value)}>
                <option value="A5">A5</option>
                <option value="A4">A4</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {PLACEHOLDER_HINTS.map(p => (
              <code key={p} style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem' }}>[{p}]</code>
            ))}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            Conditional section: <code>{'{{#IF FATHER_NAME}}...{{/IF}}'}</code> — if that field's data is empty, the entire block will be hidden.
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            QR Code: add <code>{'<img src="[QR_CODE]" width="90" height="90" />'}</code> anywhere in the template to show a scannable QR that links to this record on the public portal.
            {sampleQr && <> Sample: <img src={sampleQr} alt="Sample QR" width={40} height={40} style={{ verticalAlign: 'middle', marginLeft: 6, border: '1px solid #ddd' }} /></>}
          </p>

          {loading ? (
            <div className="inline-spinner">Loading...</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button className="btn-submit" style={{ width: 'auto' }} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={() => setPreview(p => !p)}>
                  {preview ? 'Edit' : 'Preview'}
                </button>
                <button type="button" className="btn-submit" style={{ width: 'auto', background: 'var(--danger)' }} onClick={remove}>Delete</button>
              </div>

              {preview ? (
                <div
                  className="consent-doc"
                  style={{ width: `${size.width}mm`, minHeight: `${size.height}mm`, margin: '0 auto', background: '#fff', padding: '10mm', border: '1px solid #eee', boxSizing: 'border-box' }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={22}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', padding: 10, borderRadius: 8, border: '1px solid #ddd' }}
                />
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
