import { useState } from 'react';
import { api } from '../api.js';

export default function LockYears({ years, lockedYears, onChange, onYearAdded }) {
  const [busyYear, setBusyYear] = useState(null);
  const [newYear, setNewYear] = useState('');
  const [addingYear, setAddingYear] = useState(false);

  const addYear = async (e) => {
    e.preventDefault();
    const y = parseInt(newYear);
    if (!y) return alert('Please enter a valid year (e.g. 2027)');
    setAddingYear(true);
    try {
      await api.addYear(y);
      setNewYear('');
      onYearAdded && onYearAdded();
    } catch (err) {
      alert(err.message);
    } finally {
      setAddingYear(false);
    }
  };

  const toggle = async (y) => {
    const isLocked = lockedYears.has(parseInt(y));
    const msg = isLocked ? `Unlock ${y}?` : `Lock ${y}? No one will be able to add/edit/delete anything for this year.`;
    if (!confirm(msg)) return;
    setBusyYear(y);
    try {
      if (isLocked) await api.unlockYear(y);
      else await api.lockYear(y);
      onChange();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyYear(null);
    }
  };

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Lock Data</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 15 }}>
        For any year that is locked, no one (including you) will be able to add/edit/delete collections, expenses, loans, or committee records for that year. The "All Years" view is always read-only.
      </p>
      <form onSubmit={addYear} className="glass-card" style={{ display: 'flex', gap: 10, padding: 15, marginBottom: 15 }}>
        <input
          type="number"
          placeholder="e.g. 2027"
          value={newYear}
          onChange={e => setNewYear(e.target.value)}
          style={{ flexGrow: 1 }}
        />
        <button className="btn-submit" style={{ width: 'auto', padding: '6px 14px' }} disabled={addingYear}>
          {addingYear ? '...' : 'Add Year'}
        </button>
      </form>

      <div className="glass-card">
        {(!years || years.length === 0) && <div style={{ textAlign: 'center', padding: 20 }}>No years found.</div>}
        {(years || []).map(y => {
          const locked = lockedYears.has(parseInt(y));
          return (
            <div className="data-row" key={y}>
              <div>
                <strong>{y}</strong>
                <span className="badge" style={{ marginLeft: 8, background: locked ? '#FEE2E2' : '#DCFCE7', color: locked ? '#991B1B' : '#166534' }}>
                  {locked ? 'Locked' : 'Open'}
                </span>
              </div>
              <button
                className="btn-submit"
                style={{ width: 'auto', padding: '6px 14px', background: locked ? 'var(--success)' : 'var(--danger)' }}
                disabled={busyYear === y}
                onClick={() => toggle(y)}
              >
                {busyYear === y ? '...' : (locked ? 'Unlock' : 'Lock')}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
