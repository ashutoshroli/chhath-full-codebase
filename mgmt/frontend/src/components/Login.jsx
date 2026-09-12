import { useState, useEffect, useRef, useCallback } from 'react';
import { api, saveSession } from '../api.js';
import AppFooter from './AppFooter.jsx';
import TwoFactorInput from './TwoFactorInput.jsx';
import ForgotPassword from './ForgotPassword.jsx';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let gisPromise = null;
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    const onload = () => resolve();
    const onerror = () => { gisPromise = null; reject(new Error('Google sign-in could not load.')); };
    if (existing) {
      existing.addEventListener('load', onload);
      existing.addEventListener('error', onerror);
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', onload);
    s.addEventListener('error', onerror);
    document.head.appendChild(s);
  });
  return gisPromise;
}

export default function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef(null);
  const rememberRef = useRef(remember);
  useEffect(() => { rememberRef.current = remember; }, [remember]);

  const [twoFA, setTwoFA] = useState(null);
  const [twoFAError, setTwoFAError] = useState('');
  const [twoFAResetKey, setTwoFAResetKey] = useState(0);

  const [forgot, setForgot] = useState(false);
  const [resetDone, setResetDone] = useState('');

  const completeLogin = (res, rememberNow) => {
    saveSession(res, rememberNow);
    onLogin({ name: res.name, role: res.role });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name || !password) return setError('Fill both fields');
    setLoading(true);
    try {
      const res = await api.login(name, password, remember);
      if (res && res.requires2FA) {
        setTwoFA({ tempToken: res.tempToken, remember });
        return;
      }
      completeLogin(res, remember);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const submitTwoFA = async (code) => {
    setTwoFAError('');
    setLoading(true);
    try {
      const res = await api.verify2FA(twoFA.tempToken, code);
      completeLogin(res, twoFA.remember);
    } catch (err) {
      setTwoFAError(err.message || 'Invalid or expired code.');
      setTwoFAResetKey(k => k + 1);
    } finally {
      setLoading(false);
    }
  };

  const cancelTwoFA = () => {
    setTwoFA(null);
    setTwoFAError('');
    setPassword('');
  };

  const handleGoogleCredential = useCallback(async (response) => {
    setError('');
    setGoogleLoading(true);
    try {
      const rememberNow = rememberRef.current;
      const res = await api.verifyGoogleLogin(response.credential, rememberNow);
      if (res && res.requires2FA) {
        setTwoFA({ tempToken: res.tempToken, remember: rememberNow });
        return;
      }
      saveSession(res, rememberNow);
      onLogin({ name: res.name, role: res.role });
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  }, [onLogin]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !window.google || !googleBtnRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: 300,
        });
      })
      .catch(() => { if (!cancelled) setError('Google sign-in could not load. Use your password instead.'); });
    return () => { cancelled = true; };
  }, [handleGoogleCredential]);

  return (
    <>
    <div style={{ maxWidth: 400, margin: '15vh auto 0', padding: '0 15px' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <img src="/logo.svg" alt="Navyuvak Chhath Puja Samiti" width="88" height="88" style={{ width: 88, height: 88, display: 'block', margin: '0 auto 8px' }} />
        <h2>Committee Portal</h2>
      </div>

      {forgot ? (
        <ForgotPassword
          initialName={name}
          onCancel={() => setForgot(false)}
          onDone={(msg) => {
            setForgot(false);
            setResetDone(msg || 'Your password has been reset. Please sign in.');
            setPassword('');
          }}
        />
      ) : twoFA ? (
        <div className="glass-card">
          <h3 style={{ marginTop: 0 }}>Two-Factor Authentication</h3>
          <TwoFactorInput
            onSubmit={submitTwoFA}
            disabled={loading}
            error={twoFAError}
            resetKey={twoFAResetKey}
          />
          <button
            type="button"
            onClick={cancelTwoFA}
            disabled={loading}
            style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}
          >
            ← Back to login
          </button>
        </div>
      ) : (
      <form className="glass-card" onSubmit={submit}>
        {resetDone && (
          <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid #16a34a33', borderRadius: 8, padding: '8px 10px', fontSize: '0.85rem', marginBottom: 12 }}>
            {resetDone}
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="form-group">
          <label>Username / Mobile / Email</label>
          <input value={name} onChange={e => setName(e.target.value)} autoComplete="username" placeholder="Username, Mobile, or Email" />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            Keep me logged in for 30 days
          </label>
        </div>
        <button className="btn-submit" type="submit" disabled={loading || googleLoading}>
          {loading ? 'Signing in...' : 'Secure Login'}
        </button>

        <button
          type="button"
          onClick={() => { setForgot(true); setError(''); setResetDone(''); }}
          style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          Forgot password?
        </button>

        {GOOGLE_CLIENT_ID && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 12px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <span style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              OR
              <span style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }}>
              {googleLoading
                ? <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Signing in with Google...</span>
                : <div ref={googleBtnRef} />}
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', margin: '10px 0 0' }}>
              Use the Google account whose email is on your committee login.
            </p>
          </>
        )}
      </form>
      )}
    </div>
    <AppFooter compact />
    </>
  );
}
