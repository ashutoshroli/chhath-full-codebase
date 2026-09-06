import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../usePolling.js';

// Superadmin-only tab: full monitor for the background Collection Queue (PDF +
// WhatsApp jobs). Unlike the compact QueueStatus strip on Home (last few jobs,
// any staff role), this shows EVERY user's jobs, lets you filter by status, and
// gives a Retry button on failed/stuck jobs (resets attempts and re-queues).
//
// It auto-refreshes every 10s so a Superadmin can watch the queue drain live.

const STATUS_FILTERS = [
  { id: '', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'processing', label: 'Processing' },
  { id: 'failed', label: 'Failed' },
  { id: 'done', label: 'Done' },
];

const STATUS_COLOR = {
  pending: '#1d4ed8',
  processing: '#1d4ed8',
  done: '#16a34a',
  failed: '#b91c1c',
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function QueueMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [retrying, setRetrying] = useState(null);
  const [notice, setNotice] = useState('');
  const statusRef = useRef(status);
  statusRef.current = status;

  const load = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const res = await api.getQueueJobsForSuperadmin(statusRef.current || undefined, 200);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Initial load + 10s auto-refresh, but only while the tab is VISIBLE (audit P-8).
  usePolling(() => load(false), 10000);

  // Re-load immediately when the status filter changes.
  useEffect(() => { load(true); }, [status]);

  const retry = async (jobId) => {
    setRetrying(jobId);
    setNotice('');
    try {
      await api.retryQueueJob(jobId);
      setNotice(`Job ${jobId} re-queued. It will process shortly.`);
      await load(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setRetrying(null);
    }
  };

  const counts = (data && data.counts) || { pending: 0, processing: 0, done: 0, failed: 0 };
  const maxAttempts = (data && data.maxAttempts) || 3;
  const jobs = (data && data.jobs) || [];

  return (
    <>
      <h2 style={{ marginBottom: 6 }}>Queue Monitor</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 15 }}>
        Background jobs for every user — PDF generation and WhatsApp messaging that
        run after a collection is saved. Failed or stuck jobs can be retried here.
        This view refreshes automatically every 10 seconds.
      </p>

      {/* Summary cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 15 }}>
        {[
          { key: 'pending', label: 'Pending', color: '#1d4ed8', bg: '#eff6ff' },
          { key: 'processing', label: 'Processing', color: '#1d4ed8', bg: '#eff6ff' },
          { key: 'done', label: 'Done', color: '#16a34a', bg: '#f0fdf4' },
          { key: 'failed', label: 'Failed', color: '#b91c1c', bg: '#fef2f2' },
        ].map(c => (
          <div key={c.key} style={{ background: c.bg, color: c.color, borderRadius: 10, padding: '10px 16px', minWidth: 90, textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{counts[c.key] || 0}</div>
            <div style={{ fontSize: '0.78rem' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 15 }}>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setStatus(f.id)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: '0.82rem', cursor: 'pointer',
              border: `1px solid ${status === f.id ? 'var(--primary-saffron)' : '#d1d5db'}`,
              background: status === f.id ? 'var(--primary-saffron)' : '#fff',
              color: status === f.id ? '#fff' : '#374151',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {notice && (
        <div style={{ background: '#DCFCE7', color: '#166534', borderRadius: 8, padding: '10px 12px', fontSize: '0.85rem', marginBottom: 15 }}>
          {notice}
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {loading && !data && <div className="inline-spinner">Loading...</div>}

      {/* The table is given a minWidth (760) so it is WIDER than a phone screen;
          that makes the wrapping div's overflowX:auto scroll sideways. Without it,
          width:100% squeezed all 8 columns to a few px and every cell wrapped one
          letter per line. whiteSpace:nowrap on the cells keeps them legible. */}
      {data && (
        <div className="glass-card" style={{ padding: 0, overflowX: 'auto' }}>
          {jobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
              No jobs match this filter.
            </div>
          ) : (
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>User</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Document</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Year</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Status</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Attempts</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Created</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Error</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.job_id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{j.created_by || '—'}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{j.doc_type || '(no document)'}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{j.year || '—'}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <span style={{ color: STATUS_COLOR[j.status] || '#374151', fontWeight: 600 }}>
                        {j.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{j.attempts || 0} / {maxAttempts}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtTime(j.created_at)}</td>
                    <td style={{ padding: '8px 10px', color: '#b91c1c', maxWidth: 260 }} title={j.last_error || ''}>
                      {j.last_error ? j.last_error.slice(0, 120) : ''}
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      {j.status !== 'done' ? (
                        <button
                          className="btn-submit"
                          style={{ width: 'auto', padding: '5px 12px', background: 'var(--primary-saffron)' }}
                          disabled={retrying === j.job_id}
                          onClick={() => retry(j.job_id)}
                        >
                          {retrying === j.job_id ? 'Retrying...' : 'Retry'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
