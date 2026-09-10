import { useState } from 'react';
import { api } from '../api.js';

// Two-step "Forgot password" flow, rendered inside the Login card when the user
// clicks "Forgot password?".
//   Step 1 (request): enter identifier -> backend emails a 6-digit code.
//   Step 2 (reset):    enter the emailed code + a new password -> password reset.
// On success we call onDone() so the parent returns to the login form with a
// success banner. There is NO auto-login by design (a Superadmin's 2FA must still
// be enforced on the next sign-in).
export default function ForgotPassword({ initialName = '', onCancel, onDone }) {
  const [step, setStep] = useState('request'); // 'request' | 'reset'
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter your username, mobile, or email.');
    setLoading(true);
    try {
      const res = await api.requestPasswordReset(name.trim());
      // Response is deliberately generic (anti-enumeration) — always advance to the
      // code step and show the same message.
      setInfo((res && res.message) || 'If an account matches, a reset code has been sent.');
      setStep('reset');
    } catch (err) {
      setError(err.message || 'Could not start password reset.');
    } finally {
      setLoading(false);
    }
  };

  const doReset = async (e) => {
    e.preventDefault();
    setError('');
    if (!code.trim()) return setError('Enter the 6-digit code from your email.');
    if (!newPassword) return setError('Enter a new password.');
    if (newPassword !== confirm) return setError('The two passwords do not match.');
    setLoading(true);
    try {
      const res = await api.resetPassword(name.trim(), code.trim(), newPassword);
      onDone((res && res.message) || 'Your password has been reset. Please sign in.');
    } catch (err) {
      // Password-strength messages come back here as a failure with the specific
      // rule (the code was accepted); a bad/expired code is a generic message.
      setError(err.message || 'Could not reset the password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card">
      <h3 style={{ marginTop: 0 }}>Reset your password</h3>
      {error && <div className="error-banner">{error}</div>}
      {info && step === 'reset' && (
        <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid #16a34a33', borderRadius: 8, padding: '8px 10px', fontSize: '0.82rem', marginBottom: 12 }}>
          {info}
        </div>
      )}

      {step === 'request' ? (
        <form onSubmit={requestCode}>
          <div className="form-group">
            <label>Username / Mobile / Email</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="username"
              placeholder="Username, Mobile, or Email"
              autoFocus
            />
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
            We'll email a 6-digit reset code to the address on your account. If you
            have no email on file, contact a committee admin.
          </p>
          <button className="btn-submit" type="submit" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset code'}
          </button>
        </form>
      ) : (
        <form onSubmit={doReset}>
          <div className="form-group">
            <label>6-digit code</label>
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              autoFocus
              style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: '1.2rem' }}
            />
          </div>
          <div className="form-group">
            <label>New password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="form-group">
            <label>Confirm new password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
            Use at least 8 characters. Superadmin accounts need 12+ with an
            uppercase letter, a lowercase letter and a number.
          </p>
          <button className="btn-submit" type="submit" disabled={loading}>
            {loading ? 'Resetting…' : 'Reset password'}
          </button>
          <button
            type="button"
            onClick={() => { setStep('request'); setError(''); }}
            disabled={loading}
            style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}
          >
            ← Didn't get a code? Try again
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}
      >
        ← Back to login
      </button>
    </div>
  );
}
