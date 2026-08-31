import { useState, useEffect } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

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

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    api.getUserProfile(userId)
      .then(d => setProfile({ Mobile: d.user.Mobile || '', Email: d.user.Email || '', WhatsApp: d.user.WhatsApp || '' }))
      // Was `.catch(() => {})`, so a failed load left the form silently blank and
      // saving it would then WIPE the stored mobile/email/WhatsApp.
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [open, userId]);

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
      await api.changePassword(pwForm.current, pwForm.next);
      alert('Password changed successfully.');
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
          Profile load nahi hua: {loadError} — save karne se pehle page refresh karein,
          warna aapka mobile/email/WhatsApp mit sakta hai.
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
        </>
      )}
    </Modal>
  );
}
