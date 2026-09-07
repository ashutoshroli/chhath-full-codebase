import { useState } from 'react';
import { api } from '../api.js';
import { useViewData } from '../useViewData.js';
import { invalidate } from '../cache.js';
import Modal from '../components/Modal.jsx';
import RowActions from '../components/RowActions.jsx';

const ROLES = ['Superadmin', 'Admin', 'Subadmin'];
const BLANK = { userId: '', password: '', role: '', mobile: '', email: '' };

// Superadmin: full add/edit/delete on the LOGIN sheet (Name=USERS.ID / Password
// / Role) — separate from Committee Members, which is now just per-year public
// membership. Admin: read-only list + can add a Subadmin login only (no edit/
// delete, no Admin/Superadmin logins) — role prop drives which mode renders.
export default function LoginManagement({ users, role }) {
  const isSuperadmin = role === 'Superadmin';
  const { data, loading, error, refresh } = useViewData('loginusers', () => api.getLoginUsers());
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(isSuperadmin ? BLANK : { ...BLANK, role: 'Subadmin' });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  const closeModal = () => { setShowAdd(false); setEditing(null); setForm(isSuperadmin ? BLANK : { ...BLANK, role: 'Subadmin' }); };

  const openEdit = (r) => {
    if (!isSuperadmin) return;
    setEditing(r);
    setForm({ userId: r.Name, password: '', role: r.Role, mobile: r.Mobile || '', email: r.Email || '' });
    setShowAdd(true);
  };

  // When adding a new login, picking the User auto-fills Mobile/Email from
  // their USERS record (convenience) — admin can still edit/override before
  // saving, and the backend will catch any duplicate against another login.
  const selectUser = (userId) => {
    const u = (users || []).find(x => x.ID === userId);
    setForm(f => ({ ...f, userId, mobile: f.mobile || (u && u.Mobile) || '', email: f.email || (u && u.Email) || '' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.userId || !form.role || (!editing && !form.password)) return alert('Fill all fields');
    if (!isSuperadmin && form.role !== 'Subadmin') return alert('You can only add a Subadmin login.');
    if (!/^\d{10}$/.test(form.mobile.trim())) return alert('Mobile number must be 10 digits.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return alert('Please enter a valid email.');
    setSaving(true);
    try {
      if (editing) {
        await api.updateLoginUser(editing.__rowIndex, form.password, form.role, form.mobile.trim(), form.email.trim());
      } else {
        await api.addLoginUser(form.userId, form.password, form.role, form.mobile.trim(), form.email.trim());
      }
      invalidate('loginusers');
      closeModal();
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!isSuperadmin) return;
    if (!confirm(`Delete ${r.personName}'s login?`)) return;
    try {
      await api.deleteLoginUser(r.__rowIndex);
      invalidate('loginusers');
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="inline-spinner">Loading...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  const usedIds = new Set((data || []).map(r => r.Name));

  return (
    <>
      <h2 style={{ marginBottom: 5 }}>Login Management</h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 15 }}>
        {isSuperadmin
          ? 'This is where who can log in and what their role is gets decided. The Committee Members tab is only for public designation.'
          : 'Only existing logins are shown here (read-only). You can add a new Subadmin login — edit/delete can only be done by a Superadmin.'}
      </p>
      {(!data || data.length === 0) && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No logins have been added yet.</div>}
      {(data || []).map((r, i) => (
        <div className="glass-card" style={{ padding: 15, marginBottom: 12, display: 'flex', gap: 15, alignItems: 'center' }} key={r.__rowIndex ?? i}>
          <div style={{ flexGrow: 1 }}>
            <strong>{r.personName}</strong>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.personVillage || 'N/A'}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.Mobile || 'No mobile'} {r.Email ? `| ${r.Email}` : ''}</div>
            <span className="badge" style={{ background: '#f3f4f6', color: '#374151', marginTop: 4, display: 'inline-block' }}>{r.Role}</span>
          </div>
          {isSuperadmin && <RowActions role="Superadmin" disabled={false} onEdit={() => openEdit(r)} onDelete={() => remove(r)} />}
        </div>
      ))}

      <button className="fab" onClick={() => setShowAdd(true)}><span className="material-icons-round">add</span></button>

      <Modal open={showAdd} onClose={closeModal}>
        <h3 style={{ marginBottom: 15 }}>{editing ? 'Edit Login' : (isSuperadmin ? 'Add Login' : 'Add Subadmin Login')}</h3>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>User</label>
            <select value={form.userId} disabled={!!editing} onChange={e => selectUser(e.target.value)}>
              <option value="" disabled>-- Select --</option>
              {(users || []).map(u => (
                <option key={u.ID} value={u.ID} disabled={!editing && usedIds.has(u.ID)}>{u.Name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Mobile</label>
            <input value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 digit mobile" />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
          </div>
          <div className="form-group">
            <label>Role</label>
            {isSuperadmin ? (
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="" disabled>-- Select --</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : (
              <input value="Subadmin" disabled />
            )}
          </div>
          <div className="form-group">
            <label>Password{editing ? ' — leave blank to keep unchanged' : ''}</label>
            <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </form>
      </Modal>
    </>
  );
}
