import { useEffect, useRef, useState } from 'react';
import { api, reportClientError } from '../api.js';
import Modal from './Modal.jsx';
import DiffView from './DiffView.jsx';


const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

async function pollRenderJob(jobId, isCancelled) {
  const start = Date.now();
  while (true) {
    if (isCancelled()) throw new Error('cancelled');
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error('This is taking longer than expected. It keeps running in the background — re-open "Fix using AI" shortly to see the result.');
    }
    let res;
    try {
      res = await api.getRenderJobStatus(jobId);
    } catch (e) {
      res = null;
    }
    const job = res && res.job;
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function resultFromFixRow(fix) {
  let files = [];
  try { files = fix.files_json ? JSON.parse(fix.files_json) : []; } catch (e) { files = []; }
  return {
    fixId: fix.fix_id,
    diff: fix.diff || '',
    reasoning: fix.reasoning || '',
    files,
    model: fix.model || '',
    tokens: { prompt: fix.prompt_tokens || 0, completion: fix.completion_tokens || 0 },
  };
}

export default function AiFixModal({ error, onClose }) {
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('Loading…');
  const [errMsg, setErrMsg] = useState('');
  const [result, setResult] = useState(null);
  const [creating, setCreating] = useState(false);
  const [pr, setPr] = useState(null);
  const [guidance, setGuidance] = useState('');
  const cancelledRef = useRef(false);

  const pollGenerate = async (jobId, fixId, isCancelled) => {
    setStatusMsg('Generating a fix with AI… this runs in the background and can take a little while.');
    const job = await pollRenderJob(jobId, isCancelled);
    if (isCancelled()) return;
    if (job.status === 'failed') {
      setErrMsg(job.error || 'The AI fix could not be generated.');
    } else {
      const r = job.result || {};
      setResult({ fixId, diff: r.diff, reasoning: r.reasoning, files: r.files, model: r.model, tokens: r.tokens });
    }
  };

  const startFlow = async (force, guidanceText) => {
    const isCancelled = () => cancelledRef.current;
    setLoading(true);
    setErrMsg('');
    setResult(null);
    setPr(null);
    setStatusMsg(force ? 'Starting a new AI fix…' : 'Loading…');
    try {
      if (!force) {
        const latest = await api.getLatestAiFixForError(error.error_id);
        const fix = latest && latest.fix;
        if (fix && (fix.status === 'fix_generated' || fix.status === 'pr_created' || fix.status === 'ci_running' || fix.status === 'ci_failed' || fix.status === 'needs_manual_review')) {
          setResult(resultFromFixRow(fix));
          if (fix.status === 'pr_created' && fix.pr_number) {
            setPr({ prNumber: fix.pr_number, prUrl: fix.pr_url, branch: fix.branch });
          }
          setLoading(false);
          return;
        }
        if (fix && fix.status === 'pending' && latest.jobId) {
          await pollGenerate(latest.jobId, fix.fix_id, isCancelled);
          if (!isCancelled()) setLoading(false);
          return;
        }
      }

      const start = await api.generateAiFix(error.error_id, force, force ? (guidanceText || '') : '');
      if (start && start.reused && !start.jobId) {
        const row = await api.getAiFix(start.fixId);
        setResult(resultFromFixRow(row));
        if (row.status === 'pr_created' && row.pr_number) {
          setPr({ prNumber: row.pr_number, prUrl: row.pr_url, branch: row.branch });
        }
        setLoading(false);
        return;
      }
      if (start && start.jobId) {
        await pollGenerate(start.jobId, start.fixId, isCancelled);
      } else if (start) {
        setResult(start);
      }
    } catch (err) {
      if (isCancelled()) return;
      setErrMsg(err.message || 'Failed to generate a fix.');
      reportClientError('AiFixModal', 'startFlow failed', err, { errorId: error.error_id, force: !!force });
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  useEffect(() => {
    cancelledRef.current = false;
    startFlow(false);
    return () => { cancelledRef.current = true; };
  }, [error.error_id]);

  const moveToBackground = () => {
    cancelledRef.current = true;
    onClose();
  };

  const regenerate = () => {
    cancelledRef.current = false;
    startFlow(true, guidance.trim());
  };

  return (
    <Modal open onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Fix using AI</h3>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
        Error Ref: {error.error_id} · {error.source} · {error.page || '-'}
      </p>

      {loading && (
        <>
          <div className="inline-spinner" style={{ padding: '16px 0' }}>
            {statusMsg}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            You can move this to the background — it keeps running and you can re-open "Fix using AI" to see the result.
          </div>
        </>
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

      {
}
      {!loading && (result || errMsg) && !pr && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>
            Optional: guide the next attempt (used when you press Re-generate)
          </label>
          <textarea
            value={guidance}
            onChange={e => setGuidance(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="e.g. Don't hardcode the domain — read it from VITE_API_URL. Only change api.js."
            style={{ width: '100%', fontSize: '0.8rem', fontFamily: 'inherit', padding: 8, borderRadius: 6, border: '1px solid #d1d5db', boxSizing: 'border-box' }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {loading && (
          <button
            type="button" className="btn-submit"
            style={{ width: 'auto', background: '#e0e7ff', color: '#3730a3' }}
            onClick={moveToBackground}
          >
            Move to background
          </button>
        )}
        {!loading && result && !pr && (
          <button
            type="button" className="btn-submit"
            style={{ width: 'auto', background: '#e5e7eb', color: '#111' }}
            onClick={regenerate}
            disabled={creating}
          >
            Re-generate
          </button>
        )}
        {!loading && errMsg && (
          <button
            type="button" className="btn-submit"
            style={{ width: 'auto', background: '#e5e7eb', color: '#111' }}
            onClick={regenerate}
          >
            Try again
          </button>
        )}
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
