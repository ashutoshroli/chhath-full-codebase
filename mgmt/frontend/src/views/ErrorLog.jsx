import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { isTruthyFlag } from '../flags.js';
import CleanupPanel from '../components/CleanupPanel.jsx';
import AiFixModal from '../components/AiFixModal.jsx';

const SOURCE_COLORS = {
  backend: { bg: '#FEE2E2', fg: '#991B1B' },
  frontend: { bg: '#DBEAFE', fg: '#1E40AF' },
  auth: { bg: '#FEF3C7', fg: '#92400E' },
  'whatsapp-queue': { bg: '#DCFCE7', fg: '#166534' },
  'whatsapp-loans': { bg: '#DCFCE7', fg: '#166534' },
  'whatsapp-template': { bg: '#DCFCE7', fg: '#166534' },
};

function badgeStyle(source) {
  const c = SOURCE_COLORS[source] || { bg: '#F3F4F6', fg: '#374151' };
  return { background: c.bg, color: c.fg };
}

const AI_STATUS = {
  pending: { label: 'AI: pending', bg: '#F3F4F6', fg: '#374151' },
  fix_generated: { label: 'AI: fix generated', bg: '#DBEAFE', fg: '#1E40AF' },
  pr_created: { label: 'AI: PR created', bg: '#E0E7FF', fg: '#3730A3' },
  ci_running: { label: 'AI: CI running', bg: '#FEF3C7', fg: '#92400E' },
  ci_passed: { label: 'AI: CI passed — ready to merge', bg: '#DCFCE7', fg: '#166534' },
  ci_failed: { label: 'AI: CI failed (retrying)', bg: '#FEE2E2', fg: '#991B1B' },
  merged: { label: 'AI: merged', bg: '#DCFCE7', fg: '#166534' },
  needs_manual_review: { label: 'AI: needs manual review', bg: '#FEE2E2', fg: '#991B1B' },
  failed: { label: 'AI: failed', bg: '#FEE2E2', fg: '#991B1B' },
};

function AiStatusBadge({ fix }) {
  if (!fix || !fix.status) return null;
  const s = AI_STATUS[fix.status] || { label: `AI: ${fix.status}`, bg: '#F3F4F6', fg: '#374151' };
  const attempts = fix.attempts ? ` (${fix.attempts}/3)` : '';
  const content = <span className="badge" style={{ background: s.bg, color: s.fg }}>{s.label}{attempts}</span>;
  return fix.pr_url
    ? <a href={fix.pr_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }} title={`PR #${fix.pr_number || ''}`}>{content}</a>
    : content;
}

function ErrorRow({ r, onReport, onAiFix, busy, aiFix }) {
  const [open, setOpen] = useState(false);
  const hasDetails = !!(r.stack || r.context);

  return (
    <div className="glass-card" style={{ padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span className="badge" style={badgeStyle(r.source)}>{r.source}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : ''}
        </span>
      </div>
      <p style={{ fontSize: '0.85rem', margin: '6px 0', wordBreak: 'break-word' }}><strong>Page:</strong> {r.page || '-'}</p>
      <p style={{ fontSize: '0.85rem', margin: '6px 0', wordBreak: 'break-word' }}>{r.message}</p>

      {hasDetails && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: 'var(--primary-saffron)', fontSize: '0.75rem', textDecoration: 'underline',
          }}
        >
          {open ? 'Hide details' : 'View stack / context'}
        </button>
      )}
      {open && (
        <pre
          style={{
            marginTop: 8, background: '#f9fafb', border: '1px solid #eee', borderRadius: 8,
            padding: 10, fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 260, overflowY: 'auto',
          }}
        >
          {r.context ? `context: ${r.context}\n\n` : ''}
          {r.stack || '(no stack trace was recorded)'}
        </pre>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          Ref: {r.error_id || '(missing)'}
          <AiStatusBadge fix={aiFix} />
        </span>
        {isTruthyFlag(r.reported) ? (
          <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>✓ Reported</span>
        ) : !r.error_id ? (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Old record (Ref missing) — cannot be reported
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn-submit"
              style={{ width: 'auto', padding: '4px 10px', fontSize: '0.75rem', background: '#111827' }}
              onClick={() => onAiFix(r)}
              title="Generate a fix with AI and preview the diff"
            >
              🤖 Fix using AI
            </button>
            <button
              className="btn-submit"
              style={{ width: 'auto', padding: '4px 10px', fontSize: '0.75rem' }}
              onClick={() => onReport(r.error_id)}
              disabled={busy}
            >
              {busy ? 'Sending...' : 'Report to WhatsApp'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ErrorLog({ role }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [aiFixError, setAiFixError] = useState(null);
  const [aiFixByError, setAiFixByError] = useState({});
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [onlyUnreported, setOnlyUnreported] = useState(false);
  const [limit, setLimit] = useState(300);

  const load = (lim) => {
    setLoading(true);
    setError('');
    api.getErrorLog(lim || limit)
      .then(setRows)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(limit);  }, [limit]);

  const loadAiFixes = () => {
    api.getAiFixes()
      .then(list => {
        const map = {};
        (list || []).forEach(f => { if (f.error_id && !map[f.error_id]) map[f.error_id] = f; });
        setAiFixByError(map);
      })
      .catch(() => {  });
  };
  useEffect(() => { loadAiFixes(); }, []);

  const report = async (errorId) => {
    setBusyId(errorId);
    try {
      const res = await api.reportErrorToWhatsApp(errorId);
      if (res && res.alreadyReported) {
        alert('This error has already been reported.');
      } else {
        alert(`Sent to WhatsApp (${(res && res.sentTo) || 0} Superadmin(s)).`);
      }
      load(limit);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const sources = useMemo(() => {
    const set = new Set((rows || []).map(r => r.source).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter(r => {
      if (sourceFilter !== 'All' && r.source !== sourceFilter) return false;
      if (onlyUnreported && isTruthyFlag(r.reported)) return false;
      if (!q) return true;
      return [r.message, r.page, r.source, r.error_id, r.context]
        .some(v => (v || '').toString().toLowerCase().includes(q));
    });
  }, [rows, query, sourceFilter, onlyUnreported]);

  const unreportedCount = (rows || []).filter(r => !isTruthyFlag(r.reported)).length;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Error Log</h2>
        <button
          type="button"
          className="btn-submit"
          style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem', background: '#e5e7eb', color: '#111' }}
          onClick={() => load(limit)}
        >
          🔄 Refresh
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <CleanupPanel target="error_log" label="the Error Log" role={role} onDone={() => load(limit)} />

      <div className="glass-card" style={{ padding: 12, marginBottom: 12 }}>
        <input
          placeholder="Message / page / Ref search..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ width: 'auto', flex: '0 1 auto' }}>
            {sources.map(s => <option key={s} value={s}>{s === 'All' ? 'All sources' : s}</option>)}
          </select>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ width: 'auto', flex: '0 1 auto' }}>
            <option value={300}>Last 300</option>
            <option value={600}>Last 600</option>
            <option value={1000}>Last 1000</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: '0.8rem' }}>
            <input type="checkbox" checked={onlyUnreported} onChange={e => setOnlyUnreported(e.target.checked)} style={{ width: 'auto' }} />
            Unreported only ({unreportedCount})
          </label>
        </div>
        {rows && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '8px 0 0' }}>
            Showing {filtered.length} / {rows.length} rows.
            {' '}If the same error recurs within 5 minutes, no new row is created (de-duplication), so older errors stay in the list.
          </p>
        )}
      </div>

      {loading && <div className="inline-spinner">Loading...</div>}
      {!loading && (!rows || rows.length === 0) && <div style={{ textAlign: 'center', padding: 20 }}>No errors have been logged.</div>}
      {!loading && rows && rows.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 20 }}>No errors match this filter.</div>
      )}

      {!loading && filtered.map((r, i) => (
        <ErrorRow
          key={r.error_id || `row-${r.id || i}`}
          r={r}
          onReport={report}
          onAiFix={setAiFixError}
          busy={busyId === r.error_id}
          aiFix={aiFixByError[r.error_id]}
        />
      ))}

      {aiFixError && (
        <AiFixModal
          error={aiFixError}
          onClose={() => { setAiFixError(null); loadAiFixes(); }}
        />
      )}
    </>
  );
}
