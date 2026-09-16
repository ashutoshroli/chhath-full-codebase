import { useState, useMemo } from 'react';
import { api } from '../api.js';
import { useViewData } from '../useViewData.js';
import { invalidate } from '../cache.js';
import Modal from '../components/Modal.jsx';
import RowActions from '../components/RowActions.jsx';
import { canAddView } from '../permissions.js';
import TransliterateInput from '../components/TransliterateInput.jsx';

const VIEW_ROLE_SUGGESTIONS = ['President', 'Vice President', 'Secretary', 'Treasurer', 'Member'];
const BLANK = { Name: '', 'View Role': '', 'View Role (Hindi)': '' };

export default function Committee({ year, users, role, editable }) {
  const { data, loading, error, refresh } = useViewData(`committee:${year}`, () => api.getCommittee(year), [year]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  const userMap = useMemo(() => {
    const m = {};
    (users || []).forEach(u => { m[u.ID] = u; });
    return m;
  }, [users]);

  const closeModal = () => {
    setShowAdd(false);
    setEditing(null);
    setForm(BLANK);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({ Name: r.Name, 'View Role': r['View Role'] || '', 'View Role (Hindi)': r['View Role (Hindi)'] || '' });
    setShowAdd(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.Name) return alert('Fill all fields');
    setSaving(true);
    try {
      if (editing) {
        // `Created By` is not sent: the server owns it and REJECTS it, which is what broke
        // every edit here. Omitting it keeps the stored value — updateRecord builds `SET`
        // from the keys it receives, so an unsent column is left alone.
        await api.updateRecord('COMMITEE MEMBERS', editing.__rowIndex, { Year: editing.Year, Name: form.Name, 'View Role': form['View Role'], 'View Role (Hindi)': form['View Role (Hindi)'] });
      } else {
        await api.saveRecord('COMMITEE MEMBERS', { Year: year === 'All' ? new Date().getFullYear() : year, ...form });
      }
      invalidate('committee:');
      closeModal();
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!confirm(`Delete ${r.Name}'s committee membership?`)) return;
    try {
      await api.deleteRecord('COMMITEE MEMBERS', r.__rowIndex);
      invalidate('committee:');
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="inline-spinner">Loading committee...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Active Committee</h2>
      {(!data || data.length === 0) && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No committee on record.</div>}
      {(data || []).map((r, i) => {
        const u = userMap[r.Name] || { Name: r.Name ? `${r.Name} (not in Users)` : 'Unknown', Mobile: 'N/A', Village: 'N/A' };
        return (
          <div className="glass-card" style={{ padding: 15, marginBottom: 12, display: 'flex', gap: 15, alignItems: 'center' }} key={r.__rowIndex ?? i}>
            <div style={{ width: 50, height: 50, borderRadius: '50%', background: 'var(--saffron-light)', color: 'var(--primary-saffron)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', flexShrink: 0 }}>
              {(u.Name?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ flexGrow: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{u.Name}</strong>
                <span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>{r.Year}</span>
              </div>
              {}
              {r['View Role'] && <div className="role-select-badge" style={{ display: 'inline-block', marginBottom: 4 }}>{r['View Role']}{r['View Role (Hindi)'] ? ` (${r['View Role (Hindi)']})` : ''}</div>}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.Mobile || 'N/A'} | {u.Village || 'N/A'}</div>
            </div>
            <RowActions role={role} disabled={!editable} onEdit={() => openEdit(r)} onDelete={() => remove(r)} />
          </div>
        );
      })}

      {editable && canAddView(role, 'committee') && (
        <button className="fab" onClick={() => setShowAdd(true)}><span className="material-icons-round">add</span></button>
      )}

      <Modal open={showAdd} onClose={closeModal}>
        <h3 style={{ marginBottom: 15 }}>{editing ? 'Edit Committee Member' : 'Add Committee Member'}</h3>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>User</label>
            <select value={form.Name} onChange={e => setForm({ ...form, Name: e.target.value })}>
              <option value="" disabled>-- Select --</option>
              {(users || []).map(u => <option key={u.ID} value={u.ID}>{u.Name}</option>)}
            </select>
          </div>
          <TransliterateInput
            label="View Role (public designation — shown to everyone)"
            placeholder="e.g. President, Secretary, Member"
            listId="view-role-suggestions"
            value={{ en: form['View Role'], hi: form['View Role (Hindi)'] }}
            onChange={({ en, hi }) => setForm({ ...form, 'View Role': en, 'View Role (Hindi)': hi })}
          />
          <datalist id="view-role-suggestions">
            {VIEW_ROLE_SUGGESTIONS.map(v => <option key={v} value={v} />)}
          </datalist>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
            Login (Role + Password) is now managed from the "Login Management" page.
          </p>
          <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </form>
      </Modal>
    </>
  );
}
