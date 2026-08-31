import { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import Modal from './Modal.jsx';

export default function UserProfileModal({ userId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) { setData(null); return; }
    setLoading(true);
    setError('');
    setData(null);
    api.getUserProfile(userId).then(setData).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [userId]);

  return (
    <Modal open={!!userId} onClose={onClose}>
      {loading && <div className="inline-spinner">Loading profile...</div>}
      {error && <div className="error-banner">{error}</div>}
      {data && (
        <>
          <h3 style={{ marginBottom: 10 }}>{data.user.Name}</h3>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.6 }}>
            <div>Village: {data.user.Village || '-'}</div>
            <div>Mobile: {data.user.Mobile || 'N/A'}</div>
            <div>Father's Name: {data.user["Father's Name"] || 'N/A'}</div>
            <div>Email: {data.user.Email || 'N/A'}</div>
            <div>WhatsApp: {data.user.WhatsApp || 'N/A'}</div>
            {data.user.Designation && <div>Designation: {data.user.Designation}</div>}
          </div>

          <h4 style={{ marginBottom: 8 }}>Contributions — Total: {fmt(data.totalContributed)}</h4>
          {data.contributions.length === 0 && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 15 }}>No contributions found.</p>
          )}
          {data.contributions.length > 0 && (
            <div className="profile-box-grid" style={{ marginBottom: 18 }}>
              {data.contributions.map((c, i) => (
                <div className="profile-mini-box" key={i}>
                  <strong style={{ color: 'var(--success)' }}>{fmt(c.Amount)}</strong>
                  <span>{c.Year}{c['Payment Mode'] ? ` (${c['Payment Mode']})` : ''}</span>
                </div>
              ))}
            </div>
          )}

          <h4 style={{ marginBottom: 8 }}>Loans Taken</h4>
          {data.loansTaken.length === 0 && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 15 }}>No loans taken.</p>
          )}
          {data.loansTaken.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              {data.loansTaken.map((l, i) => (
                <div key={i} style={{ fontSize: '0.85rem', padding: '5px 0', borderBottom: '1px dashed #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{l.Year} — {fmt(l.Amount)} @ {l['Intrest Rate'] || 0}% / {l.Tenure || 0}mo</span>
                  <span className={`badge ${l.Status === 'Repaid' ? 'badge-ok' : 'badge-warn'}`}>{l.Status}</span>
                </div>
              ))}
            </div>
          )}

          {data.committeeYears && data.committeeYears.length > 0 && (
            <>
              <h4 style={{ marginBottom: 8 }}>Committee Membership History</h4>
              <div className="profile-box-grid" style={{ marginBottom: 18 }}>
                {data.committeeYears.map((c, i) => (
                  <div className="profile-mini-box" key={i}>
                    <strong>{c['View Role'] || '—'}</strong>
                    <span>{c.Year}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h4 style={{ marginBottom: 8 }}>Guarantor For</h4>
          {data.guarantorFor.length === 0 && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Has not acted as a guarantor for anyone.</p>
          )}
          {data.guarantorFor.length > 0 && (
            <div>
              {data.guarantorFor.map((g, i) => (
                <div key={i} style={{ fontSize: '0.85rem', padding: '5px 0', borderBottom: '1px dashed #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{g.Year} — for {g.LoanerName} ({g.Amount != null ? fmt(g.Amount) : 'N/A'})</span>
                  {g.Status && <span className={`badge ${g.Status === 'Repaid' ? 'badge-ok' : 'badge-warn'}`}>{g.Status}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
