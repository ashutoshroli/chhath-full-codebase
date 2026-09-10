import { useEffect, useState, useRef } from 'react';
import { api } from '../api.js';
import { usePolling } from '../usePolling.js';

// Compact Collection-Queue status strip, shown on Home for every staff role.
// Polls getCollectionQueueStatus (and on a `refreshKey` bump, e.g. right after a
// save) so admins can see background PDF/WhatsApp jobs draining.
// It fails silently — a status hiccup must never disturb the Home screen.
//
// Poll interval is 20s (was 10s): Home is the default tab that every staff user
// lands on, so this poll runs the most of any in the app and reads D1 each tick.
// 20s halves those idle reads on the shared free-tier D1 budget while still
// feeling live; the 1.5s re-poll on `refreshKey` (below) keeps it snappy right
// after a save, which is the only moment sub-20s freshness actually matters.
const QUEUE_POLL_MS = 20000;
export default function QueueStatus({ refreshKey }) {
  const [counts, setCounts] = useState(null);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);

  const kickedRef = useRef(false);

  const load = async () => {
    try {
      const res = await api.getCollectionQueueStatus();
      if (res && res.counts) {
        setCounts(res.counts);
        setRecent(res.recent || []);
        // If jobs are sitting pending (e.g. the unreliable cron hasn't run),
        // nudge the on-demand processor once — so the queue drains even when no
        // new save happens. Guarded so we don't hammer it every poll.
        const waiting = (res.counts.pending || 0) + (res.counts.processing || 0);
        if (waiting > 0 && !kickedRef.current) {
          kickedRef.current = true;
          api.processCollectionQueue().catch(() => {}).finally(() => {
            // Allow another nudge on a later poll if jobs are still waiting.
            setTimeout(() => { kickedRef.current = false; }, 15000);
          });
        }
      }
    } catch (e) { /* silent — queue status is non-critical */ }
  };

  // audit P-8: polls only while the tab is VISIBLE, and refreshes once on return.
  usePolling(load, QUEUE_POLL_MS);

  // Re-poll shortly after a save so the new job shows up quickly.
  useEffect(() => {
    if (refreshKey === undefined) return;
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [refreshKey]);

  if (!counts) return null;
  const pending = (counts.pending || 0) + (counts.processing || 0);
  const failed = counts.failed || 0;

  // Nothing interesting to show (no active/failed jobs) — stay out of the way.
  if (pending === 0 && failed === 0) return null;

  return (
    <div style={{ margin: '10px 0' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: '6px 12px', borderRadius: 20, fontSize: '0.82rem',
          background: failed > 0 ? '#fef2f2' : '#eff6ff',
          border: `1px solid ${failed > 0 ? '#fecaca' : '#bfdbfe'}`,
          color: failed > 0 ? '#b91c1c' : '#1d4ed8',
        }}
        title="Background PDF/WhatsApp queue"
      >
        <span className="material-icons-round" style={{ fontSize: 18 }}>
          {pending > 0 ? 'sync' : (failed > 0 ? 'error_outline' : 'check_circle')}
        </span>
        {pending > 0 && <span>{pending} in queue</span>}
        {failed > 0 && <span>{failed} failed</span>}
        <span className="material-icons-round" style={{ fontSize: 16 }}>{open ? 'expand_less' : 'expand_more'}</span>
      </div>

      {open && (
        <div className="glass-card" style={{ padding: 10, marginTop: 8, fontSize: '0.78rem', maxWidth: 520 }}>
          <div style={{ marginBottom: 6, color: 'var(--text-muted)' }}>
            Pending: {counts.pending || 0} · Processing: {counts.processing || 0} · Done: {counts.done || 0} · Failed: {counts.failed || 0}
          </div>
          {recent.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {recent.slice(0, 8).map(j => (
                  <tr key={j.job_id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '3px 4px' }}>{j.doc_type || '—'} {j.year}</td>
                    <td style={{ padding: '3px 4px' }}>
                      <span style={{ color: j.status === 'failed' ? '#b91c1c' : (j.status === 'done' ? '#16a34a' : '#1d4ed8') }}>
                        {j.status}
                      </span>
                    </td>
                    <td style={{ padding: '3px 4px', color: '#b91c1c' }}>{j.last_error ? j.last_error.slice(0, 60) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
