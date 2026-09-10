import { useEffect, useRef, useState } from 'react';
import { api, reportClientError } from '../api.js';
import Modal from './Modal.jsx';
import DiffView from './DiffView.jsx';

// "Fix using AI" preview modal.
//
// The heavy work (Claude call + GitHub reads/commits/PR) now runs on the external
// Render service, so both steps are ASYNC:
//   - generateAiFix(errorId) -> { jobId } ; we POLL getRenderJobStatus(jobId) until
//     the Render job completes, then show the diff/reasoning it produced.
//   - createAiFixPr(fixId)   -> { jobId } ; poll the same way for the PR link.
// A missed callback can never hang the UI forever — polling gives up after a cap
// (the Worker's reconciliation cron independently times the job out server-side).
//
// Superadmin-only (enforced by the backend; reachable only from the Superadmin
// Error Log screen).

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 3 * 60 * 1000; // give up the UI poll after 3 min

// Poll getRenderJobStatus(jobId) until the job is completed/failed or we time out.
// Returns the job object ({ status, result, error }). `isCancelled` lets the caller
// abort when the modal closes.
async function pollRenderJob(jobId, isCancelled) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isCancelled()) throw new Error('cancelled');
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error('This is taking longer than expected. Check back shortly — it may still complete in the background.');
    }
    let res;
    try {
      res = await api.getRenderJobStatus(jobId);
    } catch (e) {
      // getRenderJobStatus throws on {success:false} (e.g. job not found yet);
      // treat transient errors as "keep waiting".
      res = null;
    }
    const job = res && res.job;
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export default function AiFixModal({ error, onClose }) {
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('Starting AI fix…');
  const [errMsg, setErrMsg] = useState('');
  const [result, setResult] = useState(null); // { fixId, diff, reasoning, files, model, tokens }
  const [creating, setCreating] = useState(false);
  const [pr, setPr] = useState(null); // { prNumber, prUrl, branch } once the PR is created
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const isCancelled = () => cancelledRef.current;
    (async () => {
      setLoading(true);
      setErrMsg('');
      setStatusMsg('Starting AI fix…');
      try {
        const start = await api.generateAiFix(error.error_id);
        // Async path: a jobId means Render is doing the work — poll for it.
        if (start && start.jobId) {
          setStatusMsg('Generating a fix with AI… this runs in the background and can take a little while.');
          const job = await pollRenderJob(start.jobId, isCancelled);
          if (isCancelled()) return;
          if (job.status === 'failed') {
            setErrMsg(job.error || 'The AI fix could not be generated.');
          } else {
            const r = job.result || {};
            setResult({
              fixId: start.fixId,
              diff: r.diff, reasoning: r.reasoning, files: r.files, model: r.model, tokens: r.tokens,
            });
          }
        } else if (start) {
          // Back-compat: a synchronous result (should not happen post-offload).
          setResult(start);
        }
      } catch (err) {
        if (isCancelled()) return;
        setErrMsg(err.message || 'Failed to generate a fix.');
        reportClientError('AiFixModal', 'generateAiFix failed', err, { errorId: error.error_id });
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    })();
    return () => { cancelledRef.current = true; };
  }, [error.error_id]);

  return (
    <Modal open onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Fix using AI</h3>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
        Error Ref: {error.error_id} · {error.source} · {error.page || '-'}
      </p>

      {loading && (
        <div className="inline-spinner" style={{ padding: '20px 0' }}>
          {statusMsg}
        </div>
      )}

      {!loading && errMsg && (
        <div className="error-banner" style={{ marginBottom: 12 }}>{errMsg}</div>
      )}

      {!loading && result && (
        <>
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#075985', marginBottom: 4 }}>AI reasoning</div>
            <div style={{ fontSize: '0.82rem', color: '#0c4a6e', whiteSpace: 'pre-wrap' }}>
              {result.reasoning || '(no summary provided)'}
            </div>
          </div>

          <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Proposed change (diff)</div>
          <DiffView diff={result.diff} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: '0.72rem', color: 'var(--text-muted)', margin: '10px 0' }}>
            <span>Model: {result.model}</span>
            <span>Tokens: {result.tokens ? `${result.tokens.prompt} in / ${result.tokens.completion} out` : 'n/a'}</span>
            <span>
              Files used: {(result.files || []).length ? result.files.map(f => f.path).join(', ') : '(none — inferred from stack)'}
            </span>
          </div>

          {pr ? (
            <div style={{ background: '#dcfce7', color: '#166534', borderRadius: 8, padding: '10px 12px', fontSize: '0.82rem', marginBottom: 12 }}>
              ✅ Pull request <strong>#{pr.prNumber}</strong> created on branch <code>{pr.branch}</code>.
              {' '}<a href={pr.prUrl} target="_blank" rel="noreferrer" style={{ color: '#166534', fontWeight: 700 }}>Open PR on GitHub →</a>
              <div style={{ marginTop: 4, fontSize: '0.72rem' }}>Review the CI checks there before merging.</div>
            </div>
          ) : (
            <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 8, padding: '8px 10px', fontSize: '0.78rem', marginBottom: 12 }}>
              Review the diff above. On <strong>Confirm</strong>, a branch <code>fix/error-{error.error_id}</code> is created,
              the change is committed, and a pull request is opened for review (in the background). Nothing is merged automatically.
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {!loading && result && !pr && (
          <button
            type="button" className="btn-submit"
            style={{ width: 'auto' }}
            onClick={confirmCreatePr}
            disabled={creating}
          >
            {creating ? 'Creating PR…' : 'Confirm & create PR'}
          </button>
        )}
        <button
          type="button" className="btn-submit"
          style={{ width: 'auto', background: '#e5e7eb', color: '#111' }}
          onClick={onClose}
        >
          {pr ? 'Done' : 'Close'}
        </button>
      </div>
    </Modal>
  );

  function confirmCreatePr() {
    if (!result) return;
    setCreating(true);
    setErrMsg('');
    (async () => {
      try {
        const start = await api.createAiFixPr(result.fixId);
        if (start && start.alreadyCreated) {
          setPr({ prNumber: start.prNumber, prUrl: start.prUrl, branch: start.branch });
          return;
        }
        if (start && start.jobId) {
          const job = await pollRenderJob(start.jobId, () => cancelledRef.current);
          if (cancelledRef.current) return;
          if (job.status === 'failed') {
            setErrMsg(job.error || 'Failed to create the pull request.');
          } else {
            const r = job.result || {};
            setPr({ prNumber: r.prNumber, prUrl: r.prUrl, branch: r.branch });
          }
        } else if (start) {
          setPr({ prNumber: start.prNumber, prUrl: start.prUrl, branch: start.branch });
        }
      } catch (err) {
        setErrMsg(err.message || 'Failed to create the pull request.');
        reportClientError('AiFixModal', 'createAiFixPr failed', err, { fixId: result.fixId });
      } finally {
        setCreating(false);
      }
    })();
  }
}
