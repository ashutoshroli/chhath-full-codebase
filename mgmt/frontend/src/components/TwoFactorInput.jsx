import { useState, useRef, useEffect, useCallback } from 'react';

// Mobile-friendly 6-box TOTP input with auto-advance, backspace-to-previous, and
// full paste support (pasting a 6-digit code fills every box). Calls onComplete
// with the 6-digit string when all boxes are filled. A "use a backup code"
// fallback swaps to a single free-text field for backup / recovery codes.
//
// Controlled from the parent: `disabled` (while verifying) and `resetKey` (bump to
// clear the boxes after a failed attempt).
export default function TwoFactorInput({ onSubmit, disabled, error, resetKey }) {
  const LEN = 6;
  const [digits, setDigits] = useState(Array(LEN).fill(''));
  const [useBackup, setUseBackup] = useState(false);
  const [backup, setBackup] = useState('');
  const inputs = useRef([]);

  // Clear on resetKey change (parent bumps it after a wrong code).
  useEffect(() => {
    setDigits(Array(LEN).fill(''));
    if (!useBackup && inputs.current[0]) inputs.current[0].focus();
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!useBackup && inputs.current[0]) inputs.current[0].focus();
  }, [useBackup]);

  const submitCode = useCallback((code) => {
    if (disabled) return;
    onSubmit(code);
  }, [disabled, onSubmit]);

  const handleChange = (i, val) => {
    const only = val.replace(/\D/g, '');
    if (!only) {
      // clearing this box
      const next = [...digits];
      next[i] = '';
      setDigits(next);
      return;
    }
    // If the user typed/pasted more than one digit, distribute across boxes.
    const chars = only.split('');
    const next = [...digits];
    let idx = i;
    for (const c of chars) {
      if (idx >= LEN) break;
      next[idx] = c;
      idx++;
    }
    setDigits(next);
    const nextFocus = Math.min(idx, LEN - 1);
    if (inputs.current[nextFocus]) inputs.current[nextFocus].focus();
    if (next.every(d => d !== '')) submitCode(next.join(''));
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      const next = [...digits];
      next[i - 1] = '';
      setDigits(next);
      if (inputs.current[i - 1]) inputs.current[i - 1].focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      inputs.current[i - 1].focus();
    } else if (e.key === 'ArrowRight' && i < LEN - 1) {
      inputs.current[i + 1].focus();
    }
  };

  const handlePaste = (e) => {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, LEN);
    if (!text) return;
    e.preventDefault();
    const next = Array(LEN).fill('');
    for (let k = 0; k < text.length; k++) next[k] = text[k];
    setDigits(next);
    const focusAt = Math.min(text.length, LEN - 1);
    if (inputs.current[focusAt]) inputs.current[focusAt].focus();
    if (text.length === LEN) submitCode(text);
  };

  const submitBackup = (e) => {
    e.preventDefault();
    if (disabled) return;
    const v = backup.trim();
    if (v) onSubmit(v);
  };

  if (useBackup) {
    return (
      <form onSubmit={submitBackup} style={{ marginTop: 8 }}>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-group">
          <label>Backup code</label>
          <input
            value={backup}
            onChange={e => setBackup(e.target.value)}
            placeholder="XXXXX-XXXXX"
            autoComplete="one-time-code"
            autoFocus
            disabled={disabled}
            style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}
          />
        </div>
        <button className="btn-submit" type="submit" disabled={disabled || !backup.trim()}>
          {disabled ? 'Verifying…' : 'Verify backup code'}
        </button>
        <button
          type="button"
          onClick={() => { setUseBackup(false); setBackup(''); }}
          style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          ← Use my authenticator app instead
        </button>
      </form>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      {error && <div className="error-banner">{error}</div>}
      <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem' }}>
        Enter the 6-digit code from your authenticator app
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }} onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { inputs.current[i] = el; }}
            value={d}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            disabled={disabled}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            aria-label={`Digit ${i + 1}`}
            style={{
              width: 44, height: 54, textAlign: 'center', fontSize: '1.5rem',
              borderRadius: 8, border: '1px solid #cbd5e1', padding: 0,
            }}
          />
        ))}
      </div>
      {disabled && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 10 }}>Verifying…</p>}
      <button
        type="button"
        onClick={() => setUseBackup(true)}
        style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: '0.85rem' }}
      >
        Can’t use your app? Use a backup code
      </button>
    </div>
  );
}
