import { useState, useEffect } from 'react';
import { api, clearSession } from '../api.js';
import Modal from './Modal.jsx';

// Turns an ISO timestamp into a short "X min/hours/days ago" label.
function timeAgo(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24); return `${d} day${d > 1 ? 's' : ''} ago`;
}

// Self-service settings: update own contact info (Mobile/Email/WhatsApp) and
// change own password. userId = the ID the person logged in with (this is also
// their USERS.ID and their COMMITEE MEMBERS.Name).
export default function SettingsModal({ open, onClose, userId }) {
  const [profile, setProfile] = useState({ Mobile: '', Email: '', WhatsApp: '' });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);

  // Active devices / sessions
  const [sessions, setSessions] = useState([]);
  const [sessLoading, setSessLoading] = useState(false);
  const [sessError, setSessError] = useState('');
  const [sessBusy, setSessBusy] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    api.getUserProfile(userId)
      .then(d => setProfile({ Mobile: d.user.Mobile || '', Email: d.user.Email || '', WhatsApp: d.user.WhatsApp || '' }))
      // Was `.catch(() => {})`, so a failed load left the form silently blank and
      // saving it would then WIPE the stored mobile/email/WhatsApp.
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false));
    loadSessions();
  }, [open, userId]);

  const loadSessions = () => {
    setSessLoading(true);
    setSessError('');
    api.getMySessions()
      .then(d => setSessions(d.sessions || []))
      .catch(err => setSessError(err.message))
      .finally(() => setSessLoading(false));
  };

  // Logging out the CURRENT device (or "all other" when it also caught the
  // current one) clears the local session and reloads to the login screen.
  const afterMaybeSelfLogout = (wasCurrent) => {
    if (wasCurrent) { clearSession(); window.location.reload(); }
  };

  const logoutDevice = async (s) => {
    if (!confirm('Log this device out?')) return;
    setSessBusy(true);
    try {
      const res = await api.revokeSession(s.id);
      if (res && res.wasCurrent) return afterMaybeSelfLogout(true);
      loadSessions();
    } catch (err) { alert(err.message); }
    finally { setSessBusy(false); }
  };

  const logoutAllOthers = async () => {
    if (!confirm('Log out of every OTHER device? This device stays signed in.')) return;
    setSessBusy(true);
    try {
      await api.revokeAllOtherSessions();
      loadSessions();
    } catch (err) { alert(err.message); }
    finally { setSessBusy(false); }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    if (profile.Mobile && profile.Mobile.length !== 10) return alert('Mobile number must be 10 digits');
    if (profile.WhatsApp && profile.WhatsApp.length !== 10) return alert('WhatsApp number must be 10 digits');
    setSaving(true);
    try {
      await api.updateOwnProfile(profile);
      alert('Profile updated successfully.');
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (!pwForm.current || !pwForm.next) return alert('Please fill in all fields');
    if (pwForm.next !== pwForm.confirm) return alert('New password does not match');
    setPwSaving(true);
    try {
      const res = await api.changePassword(pwForm.current, pwForm.next);
      // audit H-15: other devices are now signed out by the change. Say so, so the
      // person knows the action actually cut off whoever had the old password —
      // the whole reason for changing it.
      alert((res && res.message) || 'Password changed successfully.');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      alert(err.message);
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      {loadError && (
        <div className="error-banner">
          Profile failed to load: {loadError} — please refresh the page before saving,
          otherwise your mobile/email/WhatsApp may be lost.
        </div>
      )}
      <h3 style={{ marginBottom: 15 }}>Settings</h3>
      {loading && <div className="inline-spinner">Loading...</div>}

      {!loading && (
        <>
          <form onSubmit={saveProfile} style={{ marginBottom: 28 }}>
            <div className="form-group">
              <label>Mobile</label>
              <input value={profile.Mobile} maxLength={10} inputMode="numeric" placeholder="10 digit number" onChange={e => setProfile({ ...profile, Mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={profile.Email} onChange={e => setProfile({ ...profile, Email: e.target.value })} />
            </div>
            <div className="form-group">
              <label>WhatsApp</label>
              <input value={profile.WhatsApp} maxLength={10} inputMode="numeric" placeholder="10 digit number" onChange={e => setProfile({ ...profile, WhatsApp: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
            </div>
            <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save Contact Info'}</button>
          </form>

          <h4 style={{ marginBottom: 10 }}>Change Password</h4>
          <form onSubmit={savePassword}>
            <div className="form-group">
              <label>Current Password</label>
              <input type="password" value={pwForm.current} onChange={e => setPwForm({ ...pwForm, current: e.target.value })} />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input type="password" value={pwForm.next} onChange={e => setPwForm({ ...pwForm, next: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" value={pwForm.confirm} onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })} />
            </div>
            <button className="btn-submit" disabled={pwSaving}>{pwSaving ? 'Saving...' : 'Change Password'}</button>
          </form>

          {/* ---- Active Devices (all roles: your own logins) ---- */}
          <h4 style={{ margin: '28px 0 6px' }}>Active Devices</h4>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            Everywhere you are currently logged in. Log out any device you don't recognise.
          </p>
          {sessError && <div className="error-banner" style={{ marginBottom: 10 }}>Could not load devices: {sessError}</div>}
          {sessLoading && <div className="inline-spinner">Loading...</div>}
          {!sessLoading && sessions.length === 0 && !sessError && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No active devices found.</div>
          )}
          {!sessLoading && sessions.map(s => (
            <div key={s.id} style={{
              border: '1px solid var(--border, #e2e2e2)', borderRadius: 10, padding: '10px 12px',
              marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', overflowWrap: 'anywhere' }}>
                  {s.device || 'Unknown device'} {s.isCurrent && <span style={{ color: 'var(--success)', fontSize: '0.75rem' }}>· this device</span>}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  IP {s.ip || '—'} · signed in {timeAgo(s.createdAt)} · active {timeAgo(s.lastSeenAt)}
                </div>
              </div>
              {!s.isCurrent && (
                <button type="button" className="btn-danger" disabled={sessBusy}
                  style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', padding: '6px 10px' }}
                  onClick={() => logoutDevice(s)}>
                  Log out
                </button>
              )}
            </div>
          ))}
          {!sessLoading && sessions.filter(s => !s.isCurrent).length > 0 && (
            <button type="button" className="btn-danger" disabled={sessBusy}
              style={{ marginTop: 6, fontSize: '0.82rem' }}
              onClick={logoutAllOthers}>
              Log out of all other devices
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
