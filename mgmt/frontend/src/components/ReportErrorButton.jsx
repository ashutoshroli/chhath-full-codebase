import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Used on public pages (Consent, Receipt) where there's no admin nearby to help.
// Logs the error to the backend as soon as it's shown, then lets the person send
// it straight to Superadmin's WhatsApp with one tap.
export default function ReportErrorButton({ page, message, stack }) {
  const [errorId, setErrorId] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const [logFailed, setLogFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLogFailed(false);
    api.logError('frontend', page, message, stack)
      .then(res => {
        if (!alive) return;
        // logError() returns {success:false} (no errorId) when the D1 write itself
        // failed. Without this the button just stayed permanently `disabled` with
        // NO explanation, which looks like the app is broken.
        if (res && res.errorId) setErrorId(res.errorId);
        else setLogFailed(true);
      })
      .catch(() => { if (alive) setLogFailed(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, page]);

  const send = async () => {
    if (!errorId) return;
    setSending(true);
    try {
      await api.reportErrorToWhatsApp(errorId);
      setSent(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  if (sent) return <p style={{ color: 'var(--success)', fontSize: '0.85rem', marginTop: 10 }}>✓ Report sent to Superadmin on WhatsApp.</p>;

  if (logFailed) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 10 }}>
        This error could not be recorded on the server (an internet or server problem).
        Please inform the Superadmin directly.
      </p>
    );
  }

  return (
    <button
      type="button"
      className="btn-submit"
      style={{ background: '#e5e7eb', color: '#111', marginTop: 10 }}
      onClick={send}
      disabled={!errorId || sending}
    >
      {sending ? 'Sending...' : !errorId ? 'Preparing...' : '📩 Report this to Superadmin'}
    </button>
  );
}
