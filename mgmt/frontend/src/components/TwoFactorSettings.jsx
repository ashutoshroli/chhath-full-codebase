import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { generateQrDataUrl } from '../qrCode.js';

export default function TwoFactorSettings() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [enroll, setEnroll] = useState(null);
  const [code, setCode] = useState('');

  const [showBackup, setShowBackup] = useState(null);

  const [disablePw, setDisablePw] = useState('');
  const [regenPw, setRegenPw] = useState('');

  const loadStatus = () => {
    setLoading(true);
    api.get2FAStatus()
      .then(setStatus)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(loadStatus, []);

  const startEnroll = async () => {
    setErr(''); setBusy(true);
    try {
      const res = await api.enroll2FA();
      let qrDataUrl = '';
      try { qrDataUrl = await generateQrDataUrl(res.otpauthUri, 220); } catch (e) {  }
      setEnroll({ ...res, qrDataUrl });
      setShowBackup(null);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const confirmEnroll = async () => {
    setErr(''); setBusy(true);
    try {
      await api.confirm2FA(code.replace(/\D/g, ''), enroll.backupCodes, enroll.recoveryKey);
      setShowBackup({ backupCodes: enroll.backupCodes, recoveryKey: enroll.recoveryKey });
      setEnroll(null);
      setCode('');
      loadStatus();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const doDisable = async () => {
    if (!disablePw) return;
    if (!confirm('Turn OFF two-factor authentication for your account?')) return;
    setErr(''); setBusy(true);
    try {
      await api.disable2FA(disablePw);
      setDisablePw(''); setShowBackup(null);
      loadStatus();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const doRegen = async () => {
    if (!regenPw) return;
    setErr(''); setBusy(true);
    try {
      const res = await api.regenerate2FABackupCodes(regenPw);
      setShowBackup({ backupCodes: res.backupCodes });
      setRegenPw('');
      loadStatus();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const downloadCodes = (data) => {
    const lines = [];
    lines.push('Chhath Puja Portal — 2FA recovery information');
    lines.push('Keep this file private and safe.');
    lines.push('');
    if (data.recoveryKey) {
      lines.push('RECOVERY KEY (disables 2FA if your phone is lost):');
      lines.push('  ' + data.recoveryKey);
      lines.push('');
    }
    lines.push('BACKUP CODES (each works once):');
    (data.backupCodes || []).forEach(c => lines.push('  ' + c));
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chhath-2fa-recovery.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <div className="inline-spinner">Loading 2FA…</div>;
  if (!status || !status.eligible) return null;

  const box = { border: '1px solid var(--border, #e2e2e2)', borderRadius: 10, padding: 12, marginTop: 10 };
  const codeGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontFamily: 'monospace', fontSize: '0.95rem', margin: '8px 0' };

  return (
    <div style={{ marginTop: 28 }}>
      <h4 style={{ marginBottom: 6 }}>Two-Factor Authentication</h4>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 10 }}>
        Protect your Superadmin login with an authenticator app (Google Authenticator, Authy…).
      </p>
      {err && <div className="error-banner" style={{ marginBottom: 10 }}>{err}</div>}

      {}
      {showBackup && (
        <div style={{ ...box, borderColor: 'var(--success, #16a34a)' }}>
          <strong>Save these now — shown only once.</strong>
          {showBackup.recoveryKey && (
            <div style={{ margin: '8px 0' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Recovery key (disables 2FA if your phone is lost):</div>
              <div style={{ fontFamily: 'monospace', fontSize: '1rem', wordBreak: 'break-all' }}>{showBackup.recoveryKey}</div>
            </div>
          )}
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Backup codes (each works once):</div>
          <div style={codeGrid}>{showBackup.backupCodes.map(c => <span key={c}>{c}</span>)}</div>
          <button type="button" className="btn-submit" onClick={() => downloadCodes(showBackup)} style={{ marginTop: 4 }}>Download</button>
          <button type="button" onClick={() => setShowBackup(null)} style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}>I've saved them</button>
        </div>
      )}

      {}
      {enroll && (
        <div style={box}>
          <p style={{ marginTop: 0, fontSize: '0.9rem' }}>1. Scan this QR in your authenticator app:</p>
          {enroll.qrDataUrl
            ? <img src={enroll.qrDataUrl} alt="2FA QR code" width={220} height={220} style={{ display: 'block', margin: '0 auto' }} />
            : <div style={{ fontSize: '0.85rem' }}>Could not render QR — enter this key manually:</div>}
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', wordBreak: 'break-all' }}>
            Manual key: <code>{enroll.secret}</code>
          </p>
          <div style={{ ...box, background: 'rgba(0,0,0,0.02)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Save your recovery key + backup codes BEFORE confirming — shown only once:</div>
            <div style={{ margin: '6px 0' }}><strong>Recovery key:</strong> <span style={{ fontFamily: 'monospace' }}>{enroll.recoveryKey}</span></div>
            <div style={codeGrid}>{enroll.backupCodes.map(c => <span key={c}>{c}</span>)}</div>
            <button type="button" onClick={() => downloadCodes(enroll)} style={{ fontSize: '0.8rem' }}>Download recovery info</button>
          </div>
          <p style={{ fontSize: '0.9rem', marginBottom: 4 }}>2. Enter the 6-digit code to finish:</p>
          <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" maxLength={6} style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: '1.2rem' }} />
          <button type="button" className="btn-submit" disabled={busy || code.length !== 6} onClick={confirmEnroll} style={{ marginTop: 8 }}>
            {busy ? 'Verifying…' : 'Enable 2FA'}
          </button>
          <button type="button" onClick={() => { setEnroll(null); setCode(''); }} style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
        </div>
      )}

      {}
      {!enroll && !status.enabled && (
        <button type="button" className="btn-submit" disabled={busy} onClick={startEnroll}>
          {busy ? 'Starting…' : 'Enable Two-Factor Authentication'}
        </button>
      )}

      {!enroll && status.enabled && (
        <div style={box}>
          <div style={{ color: 'var(--success, #16a34a)', fontWeight: 600, marginBottom: 8 }}>
            ✓ 2FA is ON · {status.backupCodesRemaining} backup code{status.backupCodesRemaining === 1 ? '' : 's'} left
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: '0.85rem' }}>Regenerate backup codes (enter password):</label>
            <input type="password" value={regenPw} onChange={e => setRegenPw(e.target.value)} placeholder="Your password" />
            <button type="button" className="btn-submit" disabled={busy || !regenPw} onClick={doRegen} style={{ marginTop: 6 }}>
              Regenerate backup codes
            </button>
          </div>

          <div>
            <label style={{ fontSize: '0.85rem' }}>Disable 2FA (enter password):</label>
            <input type="password" value={disablePw} onChange={e => setDisablePw(e.target.value)} placeholder="Your password" />
            <button type="button" className="btn-danger" disabled={busy || !disablePw} onClick={doDisable} style={{ marginTop: 6 }}>
              Turn off 2FA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
