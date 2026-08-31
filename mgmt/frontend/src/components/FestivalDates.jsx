import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Small Superadmin panel — the Diwali/Nahay-Khay/Chhath Arghya dates change every
// year on the Hindu lunar calendar and can't be auto-computed, so they're set
// manually once per fund-year. Used to fill loan consent page placeholders.
export default function FestivalDates({ years }) {
  const [year, setYear] = useState((years && years[0]) || new Date().getFullYear());
  const [dates, setDates] = useState({ diwali: '', nahayKhay: '', chhathArghya: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getFestivalDates(year)
      .then(row => setDates({
        diwali: row['Diwali Next Day Date'] || '',
        nahayKhay: row['Nahay-Khay Date'] || '',
        chhathArghya: row['Chhath Morning Arghya Date'] || '',
      }))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [year]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.saveFestivalDates(year, dates.diwali, dates.nahayKhay, dates.chhathArghya);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
      <strong>Festival Dates (used for loan consent placeholders)</strong>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 10px' }}>
        These change every year — please set them here before the new fund-year begins.
      </p>
      {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="form-group">
        <label>Year</label>
        <select value={year} onChange={e => setYear(e.target.value)}>
          {(years || [year]).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading ? <div className="inline-spinner">Loading...</div> : (
        <>
          <div className="form-group">
            <label>Day After Diwali</label>
            <input type="date" value={dates.diwali} onChange={e => setDates(d => ({ ...d, diwali: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Nahay-Khay Date</label>
            <input type="date" value={dates.nahayKhay} onChange={e => setDates(d => ({ ...d, nahayKhay: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Chhath Morning Arghya Date</label>
            <input type="date" value={dates.chhathArghya} onChange={e => setDates(d => ({ ...d, chhathArghya: e.target.value }))} />
          </div>
          <button className="btn-submit" style={{ width: 'auto' }} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </>
      )}
    </div>
  );
}
