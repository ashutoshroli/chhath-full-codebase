import { useState } from 'react';
import { api } from '../api.js';
import { invalidate } from '../cache.js';
import Modal from '../components/Modal.jsx';
import RowActions from '../components/RowActions.jsx';
import VillageInput from '../components/VillageInput.jsx';
import TransliterateInput from '../components/TransliterateInput.jsx';
import UserProfileModal from '../components/UserProfileModal.jsx';
import { canAddView } from '../permissions.js';

const BLANK = {
  Name: '', 'Name (Hindi)': '',
  Village: '', 'Village (Hindi)': '',
  "Father's Name": '', "Father's Name (Hindi)": '',
  Mobile: '', Designation: '', 'Designation (Hindi)': '',
  Email: '', WhatsApp: '',
  Photo: '',
};

// Reads a File as a base64 data URL (the backend strips the data: prefix).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

// Shrinks a profile photo before upload. Phone photos are 2-5 MB, but the public portal only
// shows them as 40-80px avatars; ~480px JPEG (~30-50 KB) is plenty and keeps every page light.
// Falls back to the untouched file if the browser cannot decode it (e.g. HEIC), so the server's
// own validation message still applies.
function compressPhoto(file, maxDim = 480, quality = 0.82) {
  return fileToBase64(file).then(
    (original) =>
      new Promise((resolve) => {
        const fallback = () => resolve({ dataUrl: original, name: file.name });
        const img = new Image();
        img.onerror = fallback;
        img.onload = () => {
          try {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff'; // PNG transparency would turn black as JPEG
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (dataUrl.length >= original.length) return fallback(); // never make it bigger
            resolve({ dataUrl, name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' });
          } catch {
            fallback();
          }
        };
        img.src = original;
      })
  );
}

export default function Users({ users, loading, error, onRefresh, role }) {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewingUserId, setViewingUserId] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const filtered = (users || []).filter(u =>
    u.Name.toLowerCase().includes(search.toLowerCase()) || (u.ID || '').toLowerCase().includes(search.toLowerCase())
  );

  const closeModal = () => {
    setShowAdd(false);
    setEditing(null);
    setForm(BLANK);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      Name: u.Name, 'Name (Hindi)': u['Name (Hindi)'] || '',
      Village: u.Village || '', 'Village (Hindi)': u['Village (Hindi)'] || '',
      "Father's Name": u["Father's Name"] || '', "Father's Name (Hindi)": u["Father's Name (Hindi)"] || '',
      Mobile: u.Mobile || '', Designation: u.Designation || '', 'Designation (Hindi)': u['Designation (Hindi)'] || '',
      Email: u.Email || '', WhatsApp: u.WhatsApp || '',
      Photo: u.Photo || '',
    });
    setShowAdd(true);
  };

  const onPickPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) return alert('Please choose an image file.');
    setUploadingPhoto(true);
    try {
      const { dataUrl, name } = await compressPhoto(file);
      const res = await api.uploadUserPhoto(dataUrl, name, editing ? editing.ID : '');
      setForm(f => ({ ...f, Photo: res.url || res.photo || '' }));
    } catch (err) {
      alert(err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.Name) return alert('Name is required');
    if (form.Mobile && form.Mobile.length !== 10) return alert('Mobile number must be 10 digits');
    if (form.WhatsApp && form.WhatsApp.length !== 10) return alert('WhatsApp number must be 10 digits');
    setSaving(true);
    try {
      if (editing) {
        // `ID` is not sent: it is the member id the server allocates, so sending it back is
        // a request to REWRITE it and the server refuses. `__rowIndex` identifies the row.
        await api.updateRecord('USERS', editing.__rowIndex, { ...form });
      } else {
        await api.saveRecord('USERS', form);
      }
      invalidate('users');
      closeModal();
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u) => {
    if (!confirm(`Delete ${u.Name}? This action cannot be undone.`)) return;
    try {
      await api.deleteRecord('USERS', u.__rowIndex);
      invalidate('users');
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="inline-spinner">Loading users...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Registered Users</h2>
      <input placeholder="Search by name or ID..." style={{ marginBottom: 15 }} value={search} onChange={e => setSearch(e.target.value)} />
      <div className="glass-card">
        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 20 }}>No users found.</div>}
        {filtered.map(u => (
          <div className="data-row" key={u.ID}>
            <div style={{ cursor: 'pointer' }} onClick={() => setViewingUserId(u.ID)}>
              <strong style={{ display: 'block' }}>{u.Name}{u['Name (Hindi)'] ? ` (${u['Name (Hindi)']})` : ''}</strong>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.Village || '-'} | {u.Mobile || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>{u.Designation || 'Member'}</span>
              <RowActions role={role} onEdit={() => openEdit(u)} onDelete={() => remove(u)} />
            </div>
          </div>
        ))}
      </div>

      {canAddView(role, 'users') && (
        <button className="fab" onClick={() => setShowAdd(true)}><span className="material-icons-round">add</span></button>
      )}

      <Modal open={showAdd} onClose={closeModal}>
        <h3 style={{ marginBottom: 15 }}>{editing ? 'Edit User' : 'Add User'}</h3>
        <form onSubmit={submit}>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {form.Photo ? (
              <img
                src={form.Photo}
                alt="Profile preview"
                style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border, #ddd)' }}
              />
            ) : (
              <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#e5e7eb', color: '#6b7280', fontWeight: 700, fontSize: '1.4rem' }}>
                {(form.Name || '?').trim().charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div>
              <label style={{ display: 'block', marginBottom: 4 }}>Profile Photo</label>
              <input type="file" accept="image/*" onChange={onPickPhoto} disabled={uploadingPhoto} />
              {uploadingPhoto && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 8 }}>Uploading...</span>}
              {form.Photo && !uploadingPhoto && (
                <button type="button" className="btn-link" style={{ marginLeft: 8, fontSize: '0.8rem' }} onClick={() => setForm(f => ({ ...f, Photo: '' }))}>Remove</button>
              )}
            </div>
          </div>

          <TransliterateInput
            label="Name"
            value={{ en: form.Name, hi: form['Name (Hindi)'] }}
            onChange={({ en, hi }) => setForm({ ...form, Name: en, 'Name (Hindi)': hi })}
          />

          <div className="form-group">
            <label>Village</label>
            <VillageInput
              value={form.Village}
              hiValue={form['Village (Hindi)']}
              onChange={(en, hi) => setForm({ ...form, Village: en, 'Village (Hindi)': hi })}
            />
          </div>

          <TransliterateInput
            label="Father's Name"
            value={{ en: form["Father's Name"], hi: form["Father's Name (Hindi)"] }}
            onChange={({ en, hi }) => setForm({ ...form, "Father's Name": en, "Father's Name (Hindi)": hi })}
          />

          <div className="form-group">
            <label>Mobile</label>
            <input
              value={form.Mobile}
              maxLength={10}
              inputMode="numeric"
              placeholder="10 digit number"
              onChange={e => setForm({ ...form, Mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
            />
          </div>

          <TransliterateInput
            label="Designation"
            value={{ en: form.Designation, hi: form['Designation (Hindi)'] }}
            onChange={({ en, hi }) => setForm({ ...form, Designation: en, 'Designation (Hindi)': hi })}
          />

          <div className="form-group">
            <label>Email</label>
            <input value={form.Email} onChange={e => setForm({ ...form, Email: e.target.value })} />
          </div>

          <div className="form-group">
            <label>WhatsApp</label>
            <input
              value={form.WhatsApp}
              maxLength={10}
              inputMode="numeric"
              placeholder="10 digit number"
              onChange={e => setForm({ ...form, WhatsApp: e.target.value.replace(/\D/g, '').slice(0, 10) })}
            />
          </div>

          <button className="btn-submit" disabled={saving || uploadingPhoto}>{saving ? 'Saving...' : 'Save'}</button>
        </form>
      </Modal>

      <UserProfileModal userId={viewingUserId} onClose={() => setViewingUserId(null)} />
    </>
  );
}
