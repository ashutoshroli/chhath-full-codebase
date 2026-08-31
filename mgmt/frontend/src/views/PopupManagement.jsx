import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { isTruthyFlag } from '../flags.js';

const ROLES = ['Superadmin', 'Admin', 'Subadmin', 'Public'];
const BLANK_SLIDE = { imageUrl: '', text: '', linkUrl: '', linkText: '' };

function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('File could not be read'));
    reader.readAsDataURL(file);
  });
}

export default function PopupManagement() {
  const [popups, setPopups] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null); // null = not editing, 'new' = creating
  const [form, setForm] = useState({ title: '', roles: [...ROLES], active: true, startAt: '', endAt: '' });
  const [slides, setSlides] = useState([{ ...BLANK_SLIDE }]);
  const [saving, setSaving] = useState(false);
  const [uploadingSlide, setUploadingSlide] = useState(null);

  const refresh = () => {
    api.getPopups().then(setPopups).catch(err => setError(err.message));
  };
  useEffect(() => { refresh(); }, []);

  const startNew = () => {
    setEditingId('new');
    setForm({ title: '', roles: [...ROLES], active: true, startAt: '', endAt: '' });
    setSlides([{ ...BLANK_SLIDE }]);
  };

  const startEdit = async (popupId) => {
    setError('');
    try {
      const { popup, slides: existingSlides } = await api.getPopupWithSlides(popupId);
      setEditingId(popupId);
      setForm({
        title: popup.title,
        roles: (popup.roles || '').split(',').map(r => r.trim()).filter(Boolean),
        active: isTruthyFlag(popup.active),
        startAt: toLocalInputValue(popup.start_at),
        endAt: toLocalInputValue(popup.end_at),
      });
      setSlides(existingSlides.length ? existingSlides.map(s => ({ imageUrl: s.image_url, text: s.text, linkUrl: s.link_url, linkText: s.link_text })) : [{ ...BLANK_SLIDE }]);
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelEdit = () => { setEditingId(null); };

  const toggleRole = (role) => {
    setForm(f => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role] }));
  };

  const addSlide = () => setSlides(s => [...s, { ...BLANK_SLIDE }]);
  const removeSlide = (i) => setSlides(s => s.filter((_, idx) => idx !== i));
  const updateSlide = (i, patch) => setSlides(s => s.map((sl, idx) => idx === i ? { ...sl, ...patch } : sl));

  const uploadSlideImage = async (i, file) => {
    setUploadingSlide(i);
    try {
      const base64 = await fileToBase64(file);
      const res = await api.uploadPopupImage(base64, file.name);
      updateSlide(i, { imageUrl: res.url });
    } catch (err) {
      alert(err.message);
    } finally {
      setUploadingSlide(null);
    }
  };

  const save = async () => {
    if (!form.title.trim()) return alert('Please enter a title');
    if (slides.every(s => !s.imageUrl && !s.text.trim())) return alert('At least one slide must have an image or text');
    setSaving(true);
    setError('');
    try {
      const popupId = editingId === 'new' ? undefined : editingId;
      const res = await api.savePopup(popupId, form.title.trim(), form.roles, form.active, form.startAt, form.endAt);
      const finalId = popupId || res.popup_id;
      await api.savePopupSlides(finalId, slides.filter(s => s.imageUrl || s.text.trim()));
      setEditingId(null);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (popupId) => {
    if (!confirm('Delete this popup? All its slides will be deleted as well.')) return;
    try {
      await api.deletePopup(popupId);
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  if (editingId) {
    return (
      <>
        <h2 style={{ marginBottom: 15 }}>{editingId === 'new' ? 'New Popup' : 'Edit Popup'}</h2>
        {error && <div className="error-banner">{error}</div>}

        <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
          <div className="form-group">
            <label>Title (for Superadmin reference only, not shown to viewers)</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>

          <div className="form-group">
            <label>Visible to which roles</label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {ROLES.map(role => (
                <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} />
                  {role}
                </label>
              ))}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              "Public" shows this popup on the public transparency portal (chhathmanagment) on every page load — separate from the Superadmin/Admin/Subadmin roles, which only apply inside this mgmt portal.
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>

          <div className="form-group">
            <label>Start Date & Time</label>
            <input type="datetime-local" value={form.startAt} onChange={e => setForm({ ...form, startAt: e.target.value })} />
          </div>
          <div className="form-group">
            <label>End Date & Time</label>
            <input type="datetime-local" value={form.endAt} onChange={e => setForm({ ...form, endAt: e.target.value })} />
          </div>
        </div>

        <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
          <strong>Slides</strong>
          {slides.map((slide, i) => (
            <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: '0.85rem' }}>Slide {i + 1}</strong>
                {slides.length > 1 && (
                  <span className="material-icons-round" style={{ cursor: 'pointer', color: 'var(--danger)', fontSize: '1.1rem' }} onClick={() => removeSlide(i)}>delete</span>
                )}
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem' }}>Image (optional)</label>
                <input type="file" accept="image/*" onChange={e => e.target.files[0] && uploadSlideImage(i, e.target.files[0])} />
                {uploadingSlide === i && <div className="inline-spinner">Uploading...</div>}
                {slide.imageUrl && <img src={slide.imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: 150, marginTop: 8, borderRadius: 8 }} />}
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem' }}>Text (optional)</label>
                <textarea rows={3} value={slide.text} onChange={e => updateSlide(i, { text: e.target.value })} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ddd' }} />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem' }}>Link URL (optional)</label>
                <input value={slide.linkUrl} onChange={e => updateSlide(i, { linkUrl: e.target.value })} placeholder="https://..." />
              </div>
              {slide.linkUrl && (
                <div className="form-group">
                  <label style={{ fontSize: '0.8rem' }}>Link Text</label>
                  <input value={slide.linkText} onChange={e => updateSlide(i, { linkText: e.target.value })} placeholder="e.g. More Info" />
                </div>
              )}
            </div>
          ))}
          <button type="button" className="btn-submit" style={{ width: 'auto', marginTop: 10, background: '#e5e7eb', color: '#111' }} onClick={addSlide}>
            + Add Slide
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-submit" style={{ width: 'auto' }} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={cancelEdit}>Cancel</button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Popup Management</h2>
      {error && <div className="error-banner">{error}</div>}

      {!popups && <div className="inline-spinner">Loading...</div>}
      {popups && popups.length === 0 && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No popups have been created yet.</div>}

      {(popups || []).map(p => {
        const isActive = isTruthyFlag(p.active);
        return (
          <div className="glass-card" key={p.popup_id} style={{ padding: 15, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{p.title}</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.roles || 'All roles'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {p.start_at ? new Date(p.start_at).toLocaleString('en-IN') : 'No start'} — {p.end_at ? new Date(p.end_at).toLocaleString('en-IN') : 'No end'}
                </div>
              </div>
              <span className={`badge ${isActive ? 'badge-ok' : 'badge-warn'}`}>{isActive ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button type="button" className="icon-btn" title="Edit" onClick={() => startEdit(p.popup_id)}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span>
              </button>
              <button type="button" className="icon-btn icon-danger" title="Delete" onClick={() => remove(p.popup_id)}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span>
              </button>
            </div>
          </div>
        );
      })}

      <button className="fab" onClick={startNew}><span className="material-icons-round">add</span></button>
    </>
  );
}
