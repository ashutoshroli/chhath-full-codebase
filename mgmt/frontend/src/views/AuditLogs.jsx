import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';
import CleanupPanel from '../components/CleanupPanel.jsx';


function timeAgo(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}

const REASON_LABEL = {
  ok: 'Success',
  bad_password: 'Wrong password',
  unknown_user: 'Unknown user',
  locked_out: 'Locked out',
};

export default function AuditLogs({ role }) {
  const [tab, setTab] = useState('logins');

  return (
    <div>
      <h2 style={{ marginBottom: 6 }}>Activity &amp; Login Logs</h2>
      <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 14 }}>
        Login history, currently locked accounts, and active devices per user.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[['logins', 'Login Attempts'], ['activity', 'Activity Trail'], ['locked', 'Locked Accounts'], ['sessions', 'User Sessions']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={tab === id ? 'btn-submit' : 'btn-outline'}
            style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'logins' && <LoginAttempts />}
      {tab === 'activity' && (
        <>
          <ActivityTrail />
          <CleanupPanel target="activity_log" label="the Activity Log" role={role} />
        </>
      )}
      {tab === 'locked' && <LockedAccounts />}
      {tab === 'sessions' && <UserSessions />}
    </div>
  );
}

function ActivityTrail() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.getActivityLog({ name2: name.trim() || undefined, limit: 300 })
      .then(d => setRows(d.activity || []))
      .catch(err => { setError(err.message); reportClientError('AuditLogs', 'getActivityLog failed', err); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load();  }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Filter by user id (optional)"
          onKeyDown={e => e.key === 'Enter' && load()}
          style={{ padding: 8, borderRadius: 6, border: '1px solid #ddd', fontSize: '0.85rem', flex: '1 1 200px' }} />
        <button type="button" className="btn-outline" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={load}>Search</button>
      </div>
      {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && <div className="inline-spinner">Loading...</div>}
      {!loading && rows.length === 0 && !error && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No activity recorded yet.</div>
      )}
      {!loading && rows.map(r => (
        <div key={r.id} style={{ border: '1px solid var(--border, #e2e2e2)', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{r.name}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--primary-saffron)' }}>{r.action}</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
            {r.details || ''}{r.details ? ' · ' : ''}IP {r.ip_client_reported || '—'} · {timeAgo(r.timestamp)}
          </div>
        </div>
      ))}
    </div>
  );
}

function LoginAttempts() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('all');

  const load = () => {
    setLoading(true);
    setError('');
    const opts = { name2: name.trim() || undefined, limit: 300 };
    if (filter === 'failed') opts.failedOnly = true;
    else if (filter === 'success') opts.successOnly = true;
    api.getLoginAttempts(opts)
      .then(d => setRows(d.attempts || []))
      .catch(err => { setError(err.message); reportClientError('AuditLogs', 'getLoginAttempts failed', err); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load();  }, [filter]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Filter by user id (optional)"
          onKeyDown={e => e.key === 'Enter' && load()}
          style={{ padding: 8, borderRadius: 6, border: '1px solid #ddd', fontSize: '0.85rem', flex: '1 1 180px' }} />
        <select value={filter} onChange={e => setFilter(e.target.value)}
          style={{ padding: 8, borderRadius: 6, border: '1px solid #ddd', fontSize: '0.85rem' }}>
          <option value="all">All</option>
          <option value="failed">Failed only</option>
          <option value="success">Success only</option>
        </select>
        <button type="button" className="btn-outline" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={load}>Search</button>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && <div className="inline-spinner">Loading...</div>}
      {!loading && rows.length === 0 && !error && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No login attempts found.</div>}

      {!loading && rows.map(r => (
        <div key={r.id} style={{
          border: '1px solid var(--border, #e2e2e2)', borderLeft: `4px solid ${r.success ? 'var(--success)' : 'var(--danger)'}`,
          borderRadius: 8, padding: '8px 12px', marginBottom: 6,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{r.identifier || r.name || '—'}</span>
            <span style={{ fontSize: '0.8rem', color: r.success ? 'var(--success)' : 'var(--danger)' }}>
              {REASON_LABEL[r.reason] || r.reason || (r.success ? 'Success' : 'Failed')}
            </span>
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            IP {r.ip || '—'} · {r.device_info ? r.device_info.slice(0, 60) : 'unknown device'} · {timeAgo(r.created_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

function LockedAccounts() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    api.getLockedAccounts()
      .then(d => setRows(d.locked || []))
      .catch(err => { setError(err.message); reportClientError('AuditLogs', 'getLockedAccounts failed', err); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const unlock = async (row) => {
    setBusy(true);
    try { await api.revokeLock(row.key); load(); }
    catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };
  const unlockAll = async () => {
    if (!confirm('Unlock ALL currently locked accounts?')) return;
    setBusy(true);
    try { await api.revokeAllLocks(); load(); }
    catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
        <button type="button" className="btn-outline" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={load}>Refresh</button>
        {rows.length > 0 && (
          <button type="button" className="btn-danger" disabled={busy} style={{ fontSize: '0.82rem' }} onClick={unlockAll}>Unlock all</button>
        )}
      </div>
      {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && <div className="inline-spinner">Loading...</div>}
      {!loading && rows.length === 0 && !error && (
        <div style={{ color: 'var(--success)', fontSize: '0.85rem' }}>✓ No accounts are currently locked.</div>
      )}
      {!loading && rows.map(r => (
        <div key={r.key} style={{
          border: '1px solid var(--border, #e2e2e2)', borderRadius: 8, padding: '10px 12px', marginBottom: 8,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>🔒 {r.name}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>IP {r.ip || '—'} · {r.attempts} failed attempts</div>
          </div>
          <button type="button" className="btn-danger" disabled={busy} style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={() => unlock(r)}>Unlock now</button>
        </div>
      ))}
    </div>
  );
}

function UserSessions() {
  const [targetName, setTargetName] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const load = async () => {
    const name = targetName.trim();
    if (!name) return;
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const d = await api.getUserSessions(name);
      setRows(d.sessions || []);
    } catch (err) { setError(err.message); reportClientError('AuditLogs', 'getUserSessions failed', err); }
    finally { setLoading(false); }
  };

  const forceLogout = async (s) => {
    if (!confirm(`Force logout this device of ${targetName.trim()}?`)) return;
    setBusy(true);
    try { await api.revokeUserSession(targetName.trim(), s.id); load(); }
    catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };
  const forceLogoutAll = async () => {
    if (!confirm(`Force logout ALL devices of ${targetName.trim()}?`)) return;
    setBusy(true);
    try { await api.revokeUserSession(targetName.trim(), null); load(); }
    catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={targetName} onChange={e => setTargetName(e.target.value)} placeholder="Enter user id (e.g. USER0042)"
          onKeyDown={e => e.key === 'Enter' && load()}
          style={{ padding: 8, borderRadius: 6, border: '1px solid #ddd', fontSize: '0.85rem', flex: '1 1 200px' }} />
        <button type="button" className="btn-outline" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={load}>View sessions</button>
      </div>
      {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && <div className="inline-spinner">Loading...</div>}
      {!loading && searched && rows.length === 0 && !error && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No active sessions for this user.</div>
      )}
      {!loading && rows.length > 0 && (
        <>
          {rows.map(s => (
            <div key={s.id} style={{
              border: '1px solid var(--border, #e2e2e2)', borderRadius: 8, padding: '10px 12px', marginBottom: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', overflowWrap: 'anywhere' }}>{s.device || 'Unknown device'}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>IP {s.ip || '—'} · signed in {timeAgo(s.createdAt)} · active {timeAgo(s.lastSeenAt)}</div>
              </div>
              <button type="button" className="btn-danger" disabled={busy} style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={() => forceLogout(s)}>Force logout</button>
            </div>
          ))}
          <button type="button" className="btn-danger" disabled={busy} style={{ marginTop: 4, fontSize: '0.82rem' }} onClick={forceLogoutAll}>Force logout all devices</button>
        </>
      )}
    </div>
  );
}
