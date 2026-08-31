import { useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../api.js';

const TYPES = [
  ['loaner_consent', 'Loaner Consent'],
  ['guarantor_consent', 'Guarantor Consent'],
];

const PLACEHOLDERS = [
  'LOANER_NAME', 'GUARANTOR_NAME', 'LOAN_AMOUNT', 'MONTHLY_INTEREST_RATE', 'MINIMUM_TENURE_MONTHS',
  'FINAL_REPAYMENT_DATE', 'FINAL_REPAYMENT_DAY_NAME', 'FUND_YEAR', 'LOAN_CONSENT_ID', 'CONSENT_ID',
  'DIWALI_NEXT_DAY_DATE', 'DIWALI_NEXT_DAY_DAY_NAME', 'NAHAY_KHAY_DATE', 'NAHAY_KHAY_DAY_NAME',
  'CHHATH_MORNING_ARGHYA_DATE', 'CHHATH_MORNING_ARGHYA_DAY_NAME',
  'GUARANTOR_1_NAME', 'GUARANTOR_1_STATUS', 'GUARANTOR_2_NAME', 'GUARANTOR_2_STATUS', 'GUARANTOR_3_NAME', 'GUARANTOR_3_STATUS',
  'ACCEPTED_COUNT', 'PENDING_COUNT', 'DECLINED_COUNT',
];

export default function ConsentTemplates() {
  const [type, setType] = useState(TYPES[0][0]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getConsentPageTemplate(type).then(row => setText(row.text || '')).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [type]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateConsentPageTemplate(type, text);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const previewHtml = preview ? DOMPurify.sanitize(marked.parse(text)) : '';

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Consent Templates</h2>
      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 15 }}>
        {TYPES.map(([val, lbl]) => (
          <button key={val} className={`nav-btn ${type === val ? 'active' : ''}`} onClick={() => setType(val)}>{lbl}</button>
        ))}
      </div>

      <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
        <strong style={{ fontSize: '0.85rem' }}>Available Placeholders</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {PLACEHOLDERS.map(p => (
            <code key={p} style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem' }}>[{p}]</code>
          ))}
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
          Markdown supported: ## heading, **bold**, *italic*, --- line, numbered/bullet lists. The Checkbox and Accept/Decline buttons are not part of this text — they appear automatically on the page.
        </p>
        <p style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: 8 }}>
          <strong>Note:</strong> <code>[GENERATED_AT]</code> and <code>[QR_CODE]</code> are <strong>not</strong> available on this
          consent page — they only work in the Word/.docx consent template. If you type them here they will
          appear as plain text exactly as written.
          {' '}<code>GUARANTOR_4</code> and beyond also work automatically if a loan ever has more than 3 guarantors.
        </p>
      </div>

      {loading ? (
        <div className="inline-spinner">Loading...</div>
      ) : (
        <div className="glass-card" style={{ padding: 15 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button className="btn-submit" style={{ width: 'auto' }} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={() => setPreview(p => !p)}>
              {preview ? 'Edit' : 'Preview'}
            </button>
          </div>
          {preview ? (
            <div className="consent-doc" style={{ border: '1px solid #eee', borderRadius: 8, padding: 15 }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={22}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', padding: 10, borderRadius: 8, border: '1px solid #ddd' }}
            />
          )}
        </div>
      )}
    </>
  );
}
