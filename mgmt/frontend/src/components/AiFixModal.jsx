import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';
import Modal from './Modal.jsx';
import DiffView from './DiffView.jsx';

// "Fix using AI" preview modal (PR-1 scope):
//   - calls generateAiFix(errorId) -> Claude returns a unified diff + reasoning
//   - shows the diff, the reasoning, the files used as context, and token cost
//   - Confirm is a placeholder here; PR-2 wires it to create the branch + PR.
//
// Superadmin-only (the backend enforces it; this UI is only reachable from the
// Superadmin-only Error Log screen).
export default function AiFixModal({ error, onClose }) {
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');
  const [result, setResult] = useState(null); // { fixId, diff, reasoning, files, model, tokens }
  const [creating, setCreating] = useState(false);
  const [pr, setPr] = useState(null); // { prNumber, prUrl, branch } once the PR is created

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrMsg('');
    api.generateAiFix(error.error_id)
      .then(res => { if (!cancelled) setResult(res); })
      .catch(err => {
        if (cancelled) return;
        setErrMsg(err.message || 'Failed to generate a fix.');
        reportClientError('AiFixModal', 'generateAiFix failed', err, { errorId: error.error_id });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [error.error_id]);

  return (
    <Modal open onClose={onClose}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Fix using AI</h3>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
        Error Ref: {error.error_id} · {error.source} · {error.page || '-'}
      </p>

      {loading && (
        <div className="inline-spinner" style={{ padding: '20px 0' }}>
          Generating a fix with AI… this can take a few seconds.
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
              the change is committed, and a pull request is opened for review. Nothing is merged automatically.
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
    api.createAiFixPr(result.fixId)
      .then(res => {
        setPr({ prNumber: res.prNumber, prUrl: res.prUrl, branch: res.branch });
      })
      .catch(err => {
        setErrMsg(err.message || 'Failed to create the pull request.');
        reportClientError('AiFixModal', 'createAiFixPr failed', err, { fixId: result.fixId });
      })
      .finally(() => setCreating(false));
  }
}
