import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { isTruthyFlag } from '../flags.js';

export default function ErrorLog() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    api.getErrorLog().then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const report = async (errorId) => {
    setBusyId(errorId);
    try {
      await api.reportErrorToWhatsApp(errorId);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Error Log</h2>
      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="inline-spinner">Loading...</div>}
      {!loading && (!rows || rows.length === 0) && <div style={{ textAlign: 'center', padding: 20 }}>No errors have been logged.</div>}

      {!loading && (rows || []).map(r => (
        <div className="glass-card" key={r.error_id} style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge" style={{ background: r.source === 'backend' ? '#FEE2E2' : '#DBEAFE', color: r.source === 'backend' ? '#991B1B' : '#1E40AF' }}>{r.source}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : ''}</span>
          </div>
          <p style={{ fontSize: '0.85rem', margin: '6px 0', wordBreak: 'break-word' }}><strong>Page:</strong> {r.page || '-'}</p>
          <p style={{ fontSize: '0.85rem', margin: '6px 0', wordBreak: 'break-word' }}>{r.message}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Ref: {r.error_id}</span>
            {(isTruthyFlag(r.reported)) ? (
              <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>✓ Reported</span>
            ) : (
              <button className="btn-submit" style={{ width: 'auto', padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => report(r.error_id)} disabled={busyId === r.error_id}>
                {busyId === r.error_id ? 'Sending...' : 'Report to WhatsApp'}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
