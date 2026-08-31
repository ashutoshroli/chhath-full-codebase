import { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';

const VERIFICATION_BADGE = {
  pending: 'badge-pending', verified: 'badge-ok', rejected: 'badge-warn',
};
const VERIFICATION_LABEL = {
  pending: 'Pending Verification', verified: 'Verified', rejected: 'Rejected',
};

export default function ConsentReview() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [remarksById, setRemarksById] = useState({});
  const [filter, setFilter] = useState('all'); // all | accepted | declined

  const load = () => {
    setLoading(true);
    api.getConsentsForReview().then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const decide = async (consentId, status) => {
    setBusyId(consentId);
    setError('');
    try {
      await api.setConsentVerification(consentId, status, remarksById[consentId] || '');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const filtered = (rows || []).filter(r => filter === 'all' || r.status === filter);

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Consent Review</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="subtabs" style={{ marginBottom: 15 }}>
        {[['all', 'All'], ['accepted', 'Accepted'], ['declined', 'Declined']].map(([val, lbl]) => (
          <button key={val} className={`subtab-btn ${filter === val ? 'active' : ''}`} onClick={() => setFilter(val)}>{lbl}</button>
        ))}
      </div>

      {loading && <div className="inline-spinner">Loading...</div>}
      {!loading && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 20 }}>No records found.</div>}

      {!loading && filtered.map(r => (
        <div className="glass-card" key={r.consent_id} style={{ padding: 15, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong>{r.personName}</strong>{r.personNameHindi ? ` (${r.personNameHindi})` : ''}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {r.role === 'loaner' ? 'Loan Receiver' : 'Guarantor'} — Loan: {r.loanerName} ({fmt(r.loanAmount)}, {r.loanYear})
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Responded: {r.responded_at ? new Date(r.responded_at).toLocaleString('en-IN') : '-'}
              </div>
            </div>
            <span className={`badge ${r.status === 'accepted' ? 'badge-ok' : 'badge-warn'}`}>{r.status === 'accepted' ? 'Accepted' : 'Declined'}</span>
          </div>

          {r.status === 'declined' && (
            <div style={{ background: '#FEF3C7', color: '#92400E', padding: 10, borderRadius: 8, fontSize: '0.85rem', marginTop: 10 }}>
              <strong>Decline Remarks:</strong> {r.decline_remarks || '-'}
            </div>
          )}

          {r.status === 'accepted' && (
            <>
              <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                {r.photo_url && (
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Photo</div>
                    <a href={r.photo_url} target="_blank" rel="noreferrer">
                      <img src={r.photo_url} alt="Photo" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
                    </a>
                  </div>
                )}
                {r.signature_url && (
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Signature</div>
                    <a href={r.signature_url} target="_blank" rel="noreferrer">
                      <img src={r.signature_url} alt="Signature" style={{ width: 140, height: 100, objectFit: 'contain', borderRadius: 8, border: '1px solid #eee', background: '#fff' }} />
                    </a>
                  </div>
                )}
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 10 }}>
                Device: {r.device_id ? r.device_id.slice(0, 12) + '...' : '-'} | IP: {r.ip_address || '-'}
                {r.geo_lat && r.geo_lng && (
                  <> | <a href={`https://maps.google.com/?q=${r.geo_lat},${r.geo_lng}`} target="_blank" rel="noreferrer">Location ({r.geo_accuracy ? Math.round(r.geo_accuracy) + 'm accuracy' : 'view'})</a></>
                )}
              </div>

              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={`badge ${VERIFICATION_BADGE[r.verification_status] || 'badge-pending'}`}>
                  {VERIFICATION_LABEL[r.verification_status] || 'Pending Verification'}
                </span>
                {r.verification_status && r.verification_status !== 'pending' && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    by {r.verified_by} on {r.verified_at ? new Date(r.verified_at).toLocaleDateString('en-IN') : ''}
                    {r.verification_remarks ? ` — "${r.verification_remarks}"` : ''}
                  </span>
                )}
              </div>

              {(!r.verification_status || r.verification_status === 'pending') && (
                <div style={{ marginTop: 10 }}>
                  <input
                    placeholder="Remarks (optional)"
                    value={remarksById[r.consent_id] || ''}
                    onChange={e => setRemarksById(m => ({ ...m, [r.consent_id]: e.target.value }))}
                    style={{ marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn-submit" style={{ width: 'auto', padding: '8px 16px', background: 'var(--success)' }}
                      onClick={() => decide(r.consent_id, 'verified')} disabled={busyId === r.consent_id}
                    >
                      Approve
                    </button>
                    <button
                      className="btn-submit" style={{ width: 'auto', padding: '8px 16px', background: 'var(--danger)' }}
                      onClick={() => decide(r.consent_id, 'rejected')} disabled={busyId === r.consent_id}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}
