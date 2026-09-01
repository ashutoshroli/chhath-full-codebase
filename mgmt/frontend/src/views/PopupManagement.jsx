import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';
import { isTruthyFlag } from '../flags.js';
import { prepareImageForUpload } from '../imagePrep.js';
// Purane rows me Drive ka viewer-page URL ya `uc?export=view` ho sakta hai — dono
// browser me render nahi hote. driveUrl.js sab ko lh3 CDN form me badal deta hai.
import { driveImageUrl, driveImgOnError } from '../driveUrl.js';

const ROLES = ['Superadmin', 'Admin', 'Subadmin', 'Public'];
const BLANK_SLIDE = { imageUrl: '', text: '', linkUrl: '', linkText: '' };

// `datetime-local` gives a bare wall-clock string like "2026-09-01T01:12" with NO
// timezone, and that used to be stored verbatim. The Worker then did
// `new Date(start_at) > now`, and a bare date-time is interpreted as LOCAL time —
// which inside a Worker means UTC. So an admin in IST picking 2:31 PM produced a
// window that actually opened at 2:31 PM UTC = 8:01 PM IST, i.e. 5.5 hours late.
// Converting to a real instant here (the browser DOES know the local zone) makes
// the stored value unambiguous.
function fromLocalInputValue(local) {
  if (!local) return '';
  const d = new Date(local); // parsed in the BROWSER's zone — this is the point
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// Legacy rows are '2026-08-22 14:31:00' (space, no zone) and are read as UTC —
// which is how the Worker has always compared them. The zone is appended BEFORE
// parsing, because Chrome would otherwise happily read the string as IST wall time
// and show the admin a window 5.5h away from the one the server actually enforces.
// Keep in step with parseStoredDate in mgmt/backend/src/popups.js.
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

// Same normalization for display, so the list never shows "Invalid Date".
function fmtStamp(v) {
  if (!v) return null;
  const d = normalizeStamp(v.toString().trim());
  return d ? d.toLocaleString('en-IN') : null;
}

// Everything the DB can hand back is nullable, and the migrated slide row has
// text/link_url/link_text = NULL. Coercing here (as well as on the backend) means
// no `.trim()` in this file can ever hit null again.
const str = (v) => (v === undefined || v === null ? '' : v.toString());

// NOTE: yahan pehle ek `fileToBase64()` tha jo file ko jaisi-hai waisi bhej deta
// tha. Usko `imagePrep.js` ke `prepareImageForUpload()` ne replace kar diya —
// wajah wahan comment me hai (payload size + Worker CPU + iPhone HEIC).

// Link jaisa dikhne wala button. `btn-link` class styles.css me maujood NAHI hai,
// isliye inline style — warna ye default grey browser button dikhta.
const linkBtnStyle = {
  background: 'none', border: 'none', padding: 0, font: 'inherit',
  color: 'var(--primary-saffron)', textDecoration: 'underline', cursor: 'pointer',
};

export default function PopupManagement() {
  const [popups, setPopups] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null); // null = not editing, 'new' = creating
  const [form, setForm] = useState({ title: '', roles: [...ROLES], active: true, startAt: '', endAt: '' });
  const [slides, setSlides] = useState([{ ...BLANK_SLIDE }]);
  const [saving, setSaving] = useState(false);
  const [uploadingSlide, setUploadingSlide] = useState(null);
  const [preview, setPreview] = useState(null);       // "Preview as Public" result
  const [previewLoading, setPreviewLoading] = useState(false);

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
        title: str(popup.title),
        roles: (popup.roles || '').split(',').map(r => r.trim()).filter(Boolean),
        active: isTruthyFlag(popup.active),
        startAt: toLocalInputValue(popup.start_at),
        endAt: toLocalInputValue(popup.end_at),
      });
      // str() everywhere: a NULL text/link from the DB used to arrive as `null`,
      // and save()'s `s.text.trim()` then threw a TypeError OUTSIDE its try/catch —
      // so the Save button silently did nothing at all.
      setSlides(existingSlides.length
        ? existingSlides.map(s => ({ imageUrl: str(s.image_url), text: str(s.text), linkUrl: str(s.link_url), linkText: str(s.link_text) }))
        : [{ ...BLANK_SLIDE }]);
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
  // Slide order decides the display sequence but there was no way to change it
  // without deleting and re-adding every slide.
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
    // Pichhle attempt ka error/flag saaf karo, warna purana message naye upload pe
    // bhi chipka rehta hai.
    updateSlide(i, { imageError: '', imageBroken: false });
    try {
      // Pehle file jaisi-hai waisi bhej di jati thi. Ek phone photo 3-8 MB ki hoti
      // hai (base64 me +33%), aur Worker ka decode uspe aadha second se zyada CPU
      // le leta tha — badi photo pe upload fail. prepareImageForUpload browser me
      // hi 1600px tak downscale + JPEG kar deta hai (~200-400 KB), aur iOS ki HEIC
      // photo ko bhi JPEG bana deta hai.
      const prepped = await prepareImageForUpload(file);
      const res = await api.uploadPopupImage(prepped.base64, prepped.fileName, prepped.mimeType);
      // `res.url` is the Drive VIEWER PAGE (…/file/d/<id>/view) — an HTML document,
      // not an image, so <img src> rendered nothing. `imageUrl`/`directUrl` is the
      // actual image (…/uc?export=view&id=<id>). Every popup image uploaded through
      // this screen was broken in the editor, at login AND on the public portal.
      const imageUrl = res.imageUrl || res.directUrl || res.url;
      if (!imageUrl) throw new Error('Server ne image URL nahi bheja.');
      updateSlide(i, { imageUrl, imageError: '', imageBroken: false });
    } catch (err) {
      // `alert()` mobile pe kabhi-kabhi suppress ho jata hai, aur tab admin ko
      // lagta hai ki "kuch hua hi nahi". Error slide ke andar bhi dikhata hu.
      updateSlide(i, { imageError: err.message || 'Upload fail hua.' });
      setError(`Slide ${i + 1} ki image upload nahi hui: ${err.message}`);
      reportClientError('PopupManagement', 'Popup image upload failed', err, {
        slide: i, fileName: file && file.name, fileType: file && file.type, fileSize: file && file.size,
      });
    } finally {
      setUploadingSlide(null);
    }
  };

  const save = async () => {
    // Validation moved INSIDE the try. It used to sit outside, so a TypeError from
    // `s.text.trim()` on a NULL text escaped as an unhandled rejection and the
    // Save button did nothing — no alert, no banner, no clue.
    setSaving(true);
    setError('');
    try {
      const title = str(form.title).trim();
      if (!title) throw new Error('Please enter a title');

      // Sirf persist hone wale 4 field bhejo. `imageError`/`imageBroken` UI-only
      // state hai — usko request me bhejna bekaar payload hai.
      const usable = slides
        .filter(s => str(s.imageUrl) || str(s.text).trim())
        .map(s => ({
          imageUrl: str(s.imageUrl),
          text: str(s.text),
          linkUrl: str(s.linkUrl),
          linkText: str(s.linkText),
        }));
      if (!usable.length) throw new Error('At least one slide must have an image or text');
      if (!form.roles.length) throw new Error('Kam se kam ek role select karein, warna popup kisi ko nahi dikhega.');

      const popupId = editingId === 'new' ? undefined : editingId;
      const res = await api.savePopup(
        popupId, title, form.roles, form.active,
        // Converted to a real instant so the window isn't 5.5 h off (see
        // fromLocalInputValue).
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
              Dono khaali chhod sakte hain — tab popup bina time limit ke chalega.
              Time aapke phone ke local time me hai ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
          <strong>Slides</strong>
          {slides.map((slide, i) => (
            <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginTop: 10 }}>
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

                {/* Upload ka error yahin dikhta hai — sirf alert() pe bharosa nahi. */}
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
                    // Pehle yahan `display='none'` tha — image load na hone par woh
                    // CHUPCHAP gayab ho jati thi, to admin ko pata hi nahi chalta ki
                    // upload hua ya nahi. Ab pehle fallback endpoint, phir saaf
                    // placeholder.
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
                      Image load nahi hui — public portal pe bhi nahi dikhegi
                    </div>
                    <div style={{ color: 'var(--text-muted)', wordBreak: 'break-all', marginBottom: 6 }}>{slide.imageUrl}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a href={slide.imageUrl} target="_blank" rel="noreferrer">Link kholein</a>
                      <button type="button" style={linkBtnStyle} onClick={() => updateSlide(i, { imageBroken: false })}>Dobara koshish</button>
                      <button type="button" style={linkBtnStyle} onClick={() => updateSlide(i, { imageUrl: '', imageBroken: false, imageError: '' })}>Image hatayein</button>
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
      {/* Popups are NOT year-scoped, but this screen sits under the app's global
          year selector, which made it look as though they were. */}
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        Popups saal se independent hain — upar ka year selector inpe apply nahi hota.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {preview && (
        <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
          <strong style={{ fontSize: '0.9rem' }}>Public portal par abhi kya dikhega</strong>
          {preview.shown.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '8px 0 0' }}>
              Kuch bhi nahi. Public portal par dikhne ke liye popup me: <strong>Public</strong> role hona chahiye,
              Active hona chahiye, date window ke andar hona chahiye, aur kam se kam 1 slide honi chahiye.
            </p>
          ) : (
            <p style={{ fontSize: '0.8rem', margin: '8px 0 0' }}>
              ✅ <strong>{preview.shown[0].title}</strong> ({preview.shown[0].slides.length} slide{preview.shown[0].slides.length === 1 ? '' : 's'})
            </p>
          )}
          {preview.alsoEligibleButNotShown.length > 0 && (
            <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
              ⚠️ Public portal ek waqt me sirf <strong>pehla</strong> popup dikhata hai. Ye eligible hain par
              nahi dikhenge: {preview.alsoEligibleButNotShown.map(x => x.title).join(', ')}. Inke start/end
              time alag-alag karein.
            </div>
          )}
          {preview.droppedNoSlides.length > 0 && (
            <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
              ⚠️ Bina slide ke chhod diye gaye: {preview.droppedNoSlides.map(x => x.title).join(', ')}
            </div>
          )}
          <button
            type="button" className="btn-submit"
            style={{ width: 'auto', marginTop: 10, padding: '4px 10px', fontSize: '0.75rem', background: '#e5e7eb', color: '#111' }}
            onClick={() => setPreview(null)}
          >Band karein</button>
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
        // "Active" only means the flag is on. Whether it is actually being SHOWN
        // also depends on the date window and on having at least one slide — the
        // badge used to imply all three, which is how a popup could read "Active"
        // and still never appear anywhere.
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
                {liveNow && <span className="badge badge-ok" style={{ fontSize: '0.65rem' }}>Abhi dikh raha hai</span>}
              </div>
            </div>

            {isActive && noSlides && (
              <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
                ⚠️ Is popup me koi slide nahi hai — ye kisi ko <strong>nahi</strong> dikhega. Edit karke slide add karein.
              </div>
            )}
            {isActive && notYet && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
                ⏳ Start time abhi aaya nahi hai ({start}) — tab tak nahi dikhega.
              </div>
            )}
            {isActive && over && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '6px 10px', fontSize: '0.75rem', marginTop: 8 }}>
                ⌛ End time nikal chuka hai ({end}) — ab nahi dikhega.
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
