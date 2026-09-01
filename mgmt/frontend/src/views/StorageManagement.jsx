import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Superadmin-only tab: shows where each year's uploaded files live (R2 vs Drive)
// and lets you archive a year — move all of that year's R2 files (generated PDFs
// + consent photos/signatures) to Google Drive. Popups are never moved (they are
// year-independent and stay on R2).
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
    if (!confirm(`${year} ke saare files (PDFs + consent photos/signatures) Google Drive par move honge, aur R2 se hata diye jaayenge. Ye action R2 space free karta hai. Continue?`)) return;
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
        Naye files R2 (fast storage) par jaate hain. Purane saal ko "Move to Drive"
        se archive kar sakte hain — us saal ke saare files Drive par chale jaayenge
        aur R2 ka space free ho jaayega. Popup images hamesha R2 par rehti hain.
      </p>

      {loading && <div className="inline-spinner">Loading...</div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && data && !data.r2Enabled && (
        <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 8, padding: '10px 12px', fontSize: '0.85rem', marginBottom: 15 }}>
          ⚠️ R2 storage abhi configure nahi hai (bucket + R2_PUBLIC_BASE). Files
          filhaal Google Drive par ja rahe hain. Setup ke baad ye screen R2 usage
          dikhayegi.
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
