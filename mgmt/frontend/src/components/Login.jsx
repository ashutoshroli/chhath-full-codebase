import { useState } from 'react';
import { api, saveSession } from '../api.js';

export default function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name || !password) return setError('Fill both fields');
    setLoading(true);
    try {
      const res = await api.login(name, password, remember);
      saveSession(res, remember);
      onLogin({ name: res.name, role: res.role });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '15vh auto 0', padding: '0 15px' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span className="material-icons-round" style={{ fontSize: '3rem', color: 'var(--primary-saffron)' }}>admin_panel_settings</span>
        <h2>Committee Portal</h2>
      </div>
      <form className="glass-card" onSubmit={submit}>
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
            <input type="checkbox" style={{ width: 'auto' }} checked={remember} onChange={e => setRemember(e.target.checked)} />
            Keep me logged in for 30 days
          </label>
        </div>
        <button className="btn-submit" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Secure Login'}
        </button>
      </form>
    </div>
  );
}
