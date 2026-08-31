import { useState } from 'react';
import { api } from '../api.js';
import { invalidate } from '../cache.js';
import Modal from './Modal.jsx';
import VillageInput from './VillageInput.jsx';

export default function QuickAddUser({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ Name: '', Village: '' });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.Name) return alert('Name is required');
    setSaving(true);
    try {
      const res = await api.saveRecord('USERS', form);
      invalidate('users');
      setForm({ Name: '', Village: '' });
      onCreated(res.id);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h3 style={{ marginBottom: 15 }}>Quick Add User</h3>
      <form onSubmit={submit}>
        <div className="form-group">
          <label>Name</label>
          <input value={form.Name} onChange={e => setForm({ ...form, Name: e.target.value })} autoFocus />
        </div>
        <div className="form-group">
          <label>Village</label>
          <VillageInput value={form.Village} onChange={v => setForm({ ...form, Village: v })} />
        </div>
        <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Add & Select'}</button>
      </form>
    </Modal>
  );
}
