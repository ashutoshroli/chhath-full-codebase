import { useState } from 'react';
import { api } from '../api.js';
import { isSuperadmin } from '../permissions.js';

export default function CleanupPanel({ target, label, role, hasStatus = false, onDone }) {
  const [mode, setMode] = useState('olderThan');
  const [days, setDays] = useState('30');
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isSuperadmin(role)) return null;

  const preview = async () => {
    setError(''); setCount(null); setBusy(true);
    try {
      const r = await api.cleanupPreview(target, mode, mode === 'olderThan' ? days : undefined);
      setCount(r.count);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const run = async () => {
    const desc = mode === 'all' ? 'ALL records' : mode === 'olderThan' ? `records older than ${days} day(s)` : `${mode} records`;
    if (!confirm(`Delete ${desc} from ${label}? This cannot be undone.`)) return;
    setError(''); setBusy(true);
    try {
      const r = await api.cleanupData(target, mode, mode === 'olderThan' ? days : undefined);
      setCount(null);
      alert(`Removed ${r.removed} record(s) from ${label}.`);
      onDone && onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="glass-card" style={{ padding: 14, marginTop: 12, border: '1px solid #fde68a', background: '#fffbeb' }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>🧹 Clean up {label}</strong>
      {error && <div className="error-banner" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="form-group" style={{ marginBottom: 8 }}>
        <label style={{ fontSize: '0.8rem' }}>What to delete</label>
        <select value={mode} onChange={e => { setMode(e.target.value); setCount(null); }}>
          <option value="olderThan">Keep last N days (delete older)</option>
          {hasStatus && <option value="sent">Only Sent</option>}
          {hasStatus && <option value="failed">Only Failed</option>}
          <option value="all">Everything (All)</option>
        </select>
      </div>
      {mode === 'olderThan' && (
        <div className="form-group" style={{ marginBottom: 8 }}>
          <label style={{ fontSize: '0.8rem' }}>Keep last (days)</label>
          <input type="number" min="0" value={days} onChange={e => { setDays(e.target.value); setCount(null); }} style={{ width: 120 }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={preview} disabled={busy}>
          {busy ? '...' : 'Preview count'}
        </button>
        <button type="button" className="btn-submit" style={{ width: 'auto', background: 'var(--danger, #dc2626)' }} onClick={run} disabled={busy}>
          {busy ? 'Working...' : 'Delete'}
        </button>
        {count !== null && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{count} record(s) match</span>}
      </div>
    </div>
  );
}
