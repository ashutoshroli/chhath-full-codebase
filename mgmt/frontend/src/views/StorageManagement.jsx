import { useEffect, useState } from 'react';
import { api } from '../api.js';

function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function StorageManagement() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyYear, setBusyYear] = useState(null);
  const [result, setResult] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.getStorageOverview()
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const moveYear = async (year) => {
    if (!confirm(`All files for ${year} (PDFs + consent photos/signatures) will be moved to Google Drive and removed from R2. This frees up R2 space. Continue?`)) return;
    setBusyYear(year);
    setResult('');
    try {
      const res = await api.moveYearToDrive(year);
      setResult(res.message || `${year}: done.`);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyYear(null);
    }
  };

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Storage Management</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 15 }}>
        New files are stored on R2 (fast storage). You can archive an older year
        using "Move to Drive" — all of that year's files move to Drive and free up
        R2 space. Popup images always remain on R2.
      </p>

      {loading && <div className="inline-spinner">Loading...</div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && data && !data.r2Enabled && (
        <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 8, padding: '10px 12px', fontSize: '0.85rem', marginBottom: 15 }}>
          ⚠️ R2 storage is not configured yet (bucket + R2_PUBLIC_BASE). Files are
          currently going to Google Drive. Once set up, this screen will show R2
          usage.
        </div>
      )}

      {result && (
        <div style={{ background: '#DCFCE7', color: '#166534', borderRadius: 8, padding: '10px 12px', fontSize: '0.85rem', marginBottom: 15 }}>
          {result}
        </div>
      )}

      {!loading && data && (
        <div className="glass-card">
          {(!data.years || data.years.length === 0) && <div style={{ textAlign: 'center', padding: 20 }}>No years found.</div>}
          {(data.years || []).map(row => (
            <div className="data-row" key={row.year}>
              <div>
                <strong>{row.year}</strong>
                <span className="badge" style={{ marginLeft: 8, background: row.location === 'R2' ? '#DBEAFE' : '#E5E7EB', color: row.location === 'R2' ? '#1E40AF' : '#374151' }}>
                  {row.location === 'R2' ? 'R2 (fast)' : 'Drive (archived)'}
                </span>
                {row.location === 'R2' && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 8 }}>
                    {row.r2Count} file{row.r2Count === 1 ? '' : 's'} · {fmtBytes(row.r2Bytes)}
                  </span>
                )}
              </div>
              {data.r2Enabled && row.location === 'R2' && row.r2Count > 0 && (
                <button
                  className="btn-submit"
                  style={{ width: 'auto', padding: '6px 14px', background: 'var(--primary-saffron)' }}
                  disabled={busyYear === row.year}
                  onClick={() => moveYear(row.year)}
                >
                  {busyYear === row.year ? 'Moving...' : 'Move to Drive'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
