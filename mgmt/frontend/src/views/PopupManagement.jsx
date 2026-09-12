import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';
import { isTruthyFlag } from '../flags.js';
import { prepareImageForUpload } from '../imagePrep.js';
import Modal from '../components/Modal.jsx';
import PopupSlideshow from '../components/PopupSlideshow.jsx';
import { driveImageUrl, driveImgOnError } from '../driveUrl.js';

const ROLES = ['Superadmin', 'Admin', 'Subadmin', 'Public'];
const DEFAULT_DURATION_MS = 5000;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 60000;
const BLANK_SLIDE = { imageUrl: '', text: '', linkUrl: '', linkText: '', durationMs: DEFAULT_DURATION_MS };

function clampDurationMs(ms) {
  const n = parseInt(ms, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MS;
  if (n < MIN_DURATION_MS) return MIN_DURATION_MS;
  if (n > MAX_DURATION_MS) return MAX_DURATION_MS;
  return n;
}
let __slideKeySeq = 0;
const newSlide = (data) => ({ ...BLANK_SLIDE, ...(data || {}), _key: `sl_${Date.now()}_${__slideKeySeq++}` });

function fromLocalInputValue(local) {
  if (!local) return '';
  const d = new Date(local);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function normalizeStamp(raw) {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  let d = new Date(raw.replace(' ', 'T') + (hasZone ? '' : 'Z'));
  if (!isNaN(d.getTime())) return d;
  d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = normalizeStamp(iso.toString().trim());
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtStamp(v) {
  if (!v) return null;
  const d = normalizeStamp(v.toString().trim());
  return d ? d.toLocaleString('en-IN') : null;
}

const str = (v) => (v === undefined || v === null ? '' : v.toString());


const linkBtnStyle = {
  background: 'none', border: 'none', padding: 0, font: 'inherit',
  color: 'var(--primary-saffron)', textDecoration: 'underline', cursor: 'pointer',
};

export default function PopupManagement() {
  const [popups, setPopups] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: '', roles: [...ROLES], active: true, startAt: '', endAt: '' });
  const [slides, setSlides] = useState([newSlide()]);
  const [saving, setSaving] = useState(false);
  const [uploadingSlide, setUploadingSlide] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);

  const refresh = () => {
    api.getPopups().then(setPopups).catch(err => setError(err.message));
  };
  useEffect(() => { refresh(); }, []);

  const startNew = () => {
    setEditingId('new');
    setForm({ title: '', roles: [...ROLES], active: true, startAt: '', endAt: '' });
    setSlides([newSlide()]);
  };

  const startEdit = async (popupId) => {
    setError('');
    try {
      const { popup, slides: existingSlides } = await api.getPopupWithSlides(popupId);
      setEditingId(popupId);
      setForm({
        title: str(popup.title),
        roles: (popup.roles || '').split(',').map(r => r.trim()).filter(Boolean),
        active: isTruthyFlag(popup.active),
        startAt: toLocalInputValue(popup.start_at),
        endAt: toLocalInputValue(popup.end_at),
      });
      setSlides(existingSlides.length
        ? existingSlides.map(s => newSlide({ imageUrl: str(s.image_url), text: str(s.text), linkUrl: str(s.link_url), linkText: str(s.link_text), durationMs: clampDurationMs(s.duration_ms) }))
        : [newSlide()]);
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelEdit = () => { setEditingId(null); };

  const toggleRole = (role) => {
    setForm(f => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role] }));
  };

  const addSlide = () => setSlides(s => [...s, newSlide()]);
  const removeSlide = (i) => setSlides(s => s.filter((_, idx) => idx !== i));
  const moveSlide = (i, dir) => setSlides(s => {
    const j = i + dir;
    if (j < 0 || j >= s.length) return s;
    const copy = [...s];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  const updateSlide = (i, patch) => setSlides(s => s.map((sl, idx) => idx === i ? { ...sl, ...patch } : sl));

  const uploadSlideImage = async (i, file) => {
    setUploadingSlide(i);
    setError('');
    updateSlide(i, { imageError: '', imageBroken: false });
    try {
      const prepped = await prepareImageForUpload(file);
      const res = await api.uploadPopupImage(prepped.base64, prepped.fileName, prepped.mimeType);
      const imageUrl = res.imageUrl || res.directUrl || res.url;
      if (!imageUrl) throw new Error('The server did not return an image URL.');
      updateSlide(i, { imageUrl, imageError: '', imageBroken: false });
    } catch (err) {
      updateSlide(i, { imageError: err.message || 'Upload failed.' });
      setError(`Slide ${i + 1} image upload failed: ${err.message}`);
      reportClientError('PopupManagement', 'Popup image upload failed', err, {
        slide: i, fileName: file && file.name, fileType: file && file.type, fileSize: file && file.size,
      });
    } finally {
      setUploadingSlide(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const title = str(form.title).trim();
      if (!title) throw new Error('Please enter a title');

      const usable = slides
        .filter(s => str(s.imageUrl) || str(s.text).trim())
        .map(s => ({
          imageUrl: str(s.imageUrl),
          text: str(s.text),
          linkUrl: str(s.linkUrl),
          linkText: str(s.linkText),
          durationMs: clampDurationMs(s.durationMs),
        }));
      if (!usable.length) throw new Error('At least one slide must have an image or text');
      if (!form.roles.length) throw new Error('Select at least one role, otherwise the popup will not be shown to anyone.');

      const popupId = editingId === 'new' ? undefined : editingId;
      const res = await api.savePopup(
        popupId, title, form.roles, form.active,
        fromLocalInputValue(form.startAt), fromLocalInputValue(form.endAt)
      );
      const finalId = popupId || res.popup_id;
      await api.savePopupSlides(finalId, usable);
      setEditingId(null);
      refresh();
    } catch (err) {
      setError(err.message);
      reportClientError('PopupManagement', 'Popup save failed', err, { editingId });
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    setError('');
    try {
      setPreview(await api.previewPublicPopups());
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewLoading(false);
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
            <label>Start Date &amp; Time</label>
            <input type="datetime-local" value={form.startAt} onChange={e => setForm({ ...form, startAt: e.target.value })} />
          </div>
          <div className="form-group">
            <label>End Date &amp; Time</label>
            <input type="datetime-local" value={form.endAt} onChange={e => setForm({ ...form, endAt: e.target.value })} />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              You can leave both empty — the popup will then run with no time limit.
              The time is in your phone's local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
          <strong>Slides</strong>
          {slides.map((slide, i) => (
            <div key={slide._key ?? i} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: '0.85rem' }}>Slide {i + 1}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {slides.length > 1 && (
                    <>
                      <span
                        className="material-icons-round"
                        title="Upar le jaayein"
                        style={{ cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.3 : 1, fontSize: '1.1rem' }}
                        onClick={() => i > 0 && moveSlide(i, -1)}
                      >arrow_upward</span>
                      <span
                        className="material-icons-round"
                        title="Neeche le jaayein"
                        style={{ cursor: i === slides.length - 1 ? 'not-allowed' : 'pointer', opacity: i === slides.length - 1 ? 0.3 : 1, fontSize: '1.1rem' }}
                        onClick={() => i < slides.length - 1 && moveSlide(i, 1)}
                      >arrow_downward</span>
                      <span className="material-icons-round" title="Delete" style={{ cursor: 'pointer', color: 'var(--danger)', fontSize: '1.1rem' }} onClick={() => removeSlide(i)}>delete</span>
                    </>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem' }}>Image (optional)</label>
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif" onChange={e => e.target.files[0] && uploadSlideImage(i, e.target.files[0])} />
                {uploadingSlide === i && <div className="inline-spinner">Uploading...</div>}

                {}
                {slide.imageError && (
                  <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fdecea', color: 'var(--danger)', fontSize: '0.8rem' }}>
                    {slide.imageError}
                  </div>
                )}

                {slide.imageUrl && !slide.imageBroken && (
                  <img
                    src={driveImageUrl(slide.imageUrl)}
                    alt=""
                    style={{ maxWidth: '100%', maxHeight: 150, marginTop: 8, borderRadius: 8 }}
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.dataset.driveFallbackTried !== '1') {
                        driveImgOnError(slide.imageUrl)(e);
                        if (img.dataset.driveFallbackTried === '1') return;
                      }
                      updateSlide(i, { imageBroken: true });
                    }}
                    onLoad={() => slide.imageBroken && updateSlide(i, { imageBroken: false })}
                  />
                )}

                {slide.imageUrl && slide.imageBroken && (
                  <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px dashed var(--danger)', fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>
                      The image failed to load — it will not show on the public portal either
                    </div>
                    <div style={{ color: 'var(--text-muted)', wordBreak: 'break-all', marginBottom: 6 }}>{slide.imageUrl}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a href={slide.imageUrl} target="_blank" rel="noreferrer">Open link</a>
                      <button type="button" style={linkBtnStyle} onClick={() => updateSlide(i, { imageBroken: false })}>Try again</button>
                      <button type="button" style={linkBtnStyle} onClick={() => updateSlide(i, { imageUrl: '', imageBroken: false, imageError: '' })}>Remove image</button>
                    </div>
                  </div>
                )}
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

              {
}
              <div className="form-group">
                <label style={{ fontSize: '0.8rem' }}>Auto-play duration (seconds)</label>
                <input
                  type="number"
                  min={MIN_DURATION_MS / 1000}
                  max={MAX_DURATION_MS / 1000}
                  step={1}
                  value={Math.round((slide.durationMs ?? DEFAULT_DURATION_MS) / 1000)}
                  onChange={e => {
                    const secs = parseInt(e.target.value, 10);
                    updateSlide(i, { durationMs: Number.isFinite(secs) ? secs * 1000 : '' });
                  }}
                  onBlur={() => updateSlide(i, { durationMs: clampDurationMs(slide.durationMs) })}
                  style={{ maxWidth: 120 }}
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {slides.length > 1
                    ? `Is slide ke baad agli slide par jaane se pehle itni der rukega (${MIN_DURATION_MS / 1000}-${MAX_DURATION_MS / 1000}s). Aakhri slide ke baad wapas pehli par loop hota hai.`
                    : `Auto-play sirf tab chalta hai jab 2 ya zyada slides hon — abhi ek hi slide hai.`}
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="btn-submit" style={{ width: 'auto', marginTop: 10, background: '#e5e7eb', color: '#111' }} onClick={addSlide}>
            + Add Slide
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-submit" style={{ width: 'auto' }} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          <button
            type="button" className="btn-submit"
            style={{ width: 'auto', background: '#111827', color: '#fff' }}
            onClick={() => setShowLivePreview(true)}
          >👁 Live Preview</button>
          <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={cancelEdit}>Cancel</button>
        </div>

        {
}
        {showLivePreview && (
          <Modal open onClose={() => setShowLivePreview(false)}>
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Live Preview</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
              Bilkul waisa hi jaisa public portal par dikhega — auto-play + loop chal raha hai; mouse le jaane par ruk jaata hai.
            </p>
            <PopupSlideshow
              slides={slides.filter(s => (s.imageUrl || (s.text || '').trim()))}
            />
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Popup Management</h2>
        <button
          type="button" className="btn-submit"
          style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem', background: '#e5e7eb', color: '#111' }}
          onClick={runPreview} disabled={previewLoading}
        >
          {previewLoading ? 'Checking...' : '👁 Preview as Public'}
        </button>
      </div>
      {
}
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        Popups are independent of the year — the year selector above does not apply to them.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {preview && (
        <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
          <strong style={{ fontSize: '0.9rem' }}>What will show on the public portal right now</strong>
          {preview.shown.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '8px 0 0' }}>
              Nothing. To appear on the public portal, a popup must have the <strong>Public</strong> role,
              be Active, fall within its date window, and have at least 1 slide.
            </p>
          ) : (
            <p style={{ fontSize: '0.8rem', margin: '8px 0 0' }}>
              ✅ <strong>{preview.shown[0].title}</strong> ({preview.shown[0].slides.length} slide{preview.shown[0].slides.length === 1 ? '' : 's'})
            </p>
          )}
          {preview.alsoEligibleButNotShown.length > 0 && (
            <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
              ⚠️ The public portal shows only the <strong>first</strong> popup at a time. These are eligible but
              will not show: {preview.alsoEligibleButNotShown.map(x => x.title).join(', ')}. Set their start/end
              times to different windows.
            </div>
          )}
          {preview.droppedNoSlides.length > 0 && (
            <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
              ⚠️ Dropped because they have no slides: {preview.droppedNoSlides.map(x => x.title).join(', ')}
            </div>
          )}
          <button
            type="button" className="btn-submit"
            style={{ width: 'auto', marginTop: 10, padding: '4px 10px', fontSize: '0.75rem', background: '#e5e7eb', color: '#111' }}
            onClick={() => setPreview(null)}
          >Close</button>
        </div>
      )}

      {!popups && <div className="inline-spinner">Loading...</div>}
      {popups && popups.length === 0 && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No popups have been created yet.</div>}

      {(popups || []).map(p => {
        const isActive = isTruthyFlag(p.active);
        const noSlides = p.slide_count === 0;
        const start = fmtStamp(p.start_at);
        const end = fmtStamp(p.end_at);
        const now = Date.now();
        const notYet = p.start_at && new Date(p.start_at).getTime() > now;
        const over = p.end_at && new Date(p.end_at).getTime() < now;
        const liveNow = isActive && !noSlides && !notYet && !over;
        return (
          <div className="glass-card" key={p.popup_id} style={{ padding: 15, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{p.title}</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.roles || 'All roles'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {start || 'No start'} — {end || 'No end'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {p.slide_count} slide{p.slide_count === 1 ? '' : 's'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                <span className={`badge ${isActive ? 'badge-ok' : 'badge-warn'}`}>{isActive ? 'Active' : 'Inactive'}</span>
                {liveNow && <span className="badge badge-ok" style={{ fontSize: '0.65rem' }}>Showing now</span>}
              </div>
            </div>

            {isActive && noSlides && (
              <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
                ⚠️ This popup has no slides — it will <strong>not</strong> be shown to anyone. Edit it to add a slide.
              </div>
            )}
            {isActive && notYet && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
                ⏳ The start time has not arrived yet ({start}) — it will not show until then.
              </div>
            )}
            {isActive && over && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
                ⌛ The end time has passed ({end}) — it will no longer show.
              </div>
            )}
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
