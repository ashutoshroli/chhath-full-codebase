import { useEffect, useState } from 'react';
import { api } from '../api.js';

// "Journey Content" — manages the public "Our Journey / 10 Years of Chhath" story:
// the bilingual tagline (portal_settings journey_tagline_en/_hi) and the per-year
// entries (journey_entries: year, title en/hi, content en/hi, order). Superadmin
// tool; self-contained (fetches its own data).
const BLANK = { id: null, year: '', title_en: '', title_hi: '', content_en: '', content_hi: '' };

export default function JourneyContent() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(BLANK);
  const [editingOpen, setEditingOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Tagline
  const [taglineEn, setTaglineEn] = useState('');
  const [taglineHi, setTaglineHi] = useState('');
  const [taglineSaving, setTaglineSaving] = useState(false);
  const [taglineMsg, setTaglineMsg] = useState('');

  const refresh = () => {
    setLoading(true);
    return api.getJourneyEntries()
      .then((rows) => setEntries(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    Promise.all([api.getPortalSetting('journey_tagline_en'), api.getPortalSetting('journey_tagline_hi')])
      .then(([en, hi]) => { setTaglineEn((en && en.value) || ''); setTaglineHi((hi && hi.value) || ''); })
      .catch(() => {});
  }, []);

  const startNew = () => {
    const nextYear = entries.length ? Math.max(...entries.map((e) => Number(e.year) || 0)) + 1 : new Date().getFullYear();
    setForm({ ...BLANK, year: String(nextYear) });
    setEditingOpen(true);
  };

  const startEdit = (e) => {
    setForm({
      id: e.id, year: String(e.year || ''),
      title_en: e.title_en || '', title_hi: e.title_hi || '',
      content_en: e.content_en || '', content_hi: e.content_hi || '',
    });
    setEditingOpen(true);
  };

  const closeForm = () => { setEditingOpen(false); setForm(BLANK); };

  const save = async (ev) => {
    ev.preventDefault();
    if (!String(form.year).trim()) return alert('Year is required');
    if (!form.title_en.trim() && !form.title_hi.trim()) return alert('A title (English or Hindi) is required');
    setSaving(true);
    try {
      await api.saveJourneyEntry({
        id: form.id || undefined,
        year: parseInt(form.year, 10),
        title_en: form.title_en, title_hi: form.title_hi,
        content_en: form.content_en, content_hi: form.content_hi,
      });
      closeForm();
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e) => {
    if (!confirm(`Delete the ${e.year} entry? This cannot be undone.`)) return;
    try {
      await api.deleteJourneyEntry(e.id);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const move = async (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= entries.length) return;
    const next = entries.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setEntries(next); // optimistic
    try {
      await api.reorderJourneyEntries(next.map((e) => e.id));
    } catch (err) {
      alert(err.message);
      refresh();
    }
  };

  const saveTagline = async (ev) => {
    ev.preventDefault();
    setTaglineSaving(true);
    setTaglineMsg('');
    try {
      await api.setPortalSetting('journey_tagline_en', taglineEn);
      await api.setPortalSetting('journey_tagline_hi', taglineHi);
      setTaglineMsg('Saved.');
    } catch (err) {
      alert(err.message);
    } finally {
      setTaglineSaving(false);
    }
  };

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Journey Content</h2>

      {/* Tagline editor */}
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 10 }}>Tagline</h3>
        <form onSubmit={saveTagline}>
          <div className="form-group">
            <label>Tagline (English)</label>
            <input value={taglineEn} onChange={(e) => setTaglineEn(e.target.value)} placeholder="A decade of faith, unity and service" />
          </div>
          <div className="form-group">
            <label>Tagline (Hindi)</label>
            <input value={taglineHi} onChange={(e) => setTaglineHi(e.target.value)} placeholder="आस्था, एकता और सेवा का एक दशक" />
          </div>
          <button className="btn-submit" disabled={taglineSaving}>{taglineSaving ? 'Saving...' : 'Save Tagline'}</button>
          {taglineMsg && <span style={{ marginLeft: 10, color: 'var(--success)', fontSize: '0.85rem' }}>{taglineMsg}</span>}
        </form>
      </div>

      {/* Entries */}
      <h3 style={{ marginBottom: 10 }}>Year Entries</h3>
      {loading ? (
        <div className="inline-spinner">Loading journey entries...</div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : (
        <div className="glass-card">
          {entries.length === 0 && <div style={{ textAlign: 'center', padding: 20 }}>No entries yet.</div>}
          {entries.map((e, i) => (
            <div className="data-row" key={e.id}>
              <div>
                <strong style={{ display: 'block' }}>{e.title_en || e.title_hi || e.year}</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{e.year} · pos {e.position}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <span className="material-icons-round">arrow_upward</span>
                </button>
                <button className="icon-btn" title="Move down" disabled={i === entries.length - 1} onClick={() => move(i, 1)}>
                  <span className="material-icons-round">arrow_downward</span>
                </button>
                <button className="icon-btn" title="Edit" onClick={() => startEdit(e)}>
                  <span className="material-icons-round">edit</span>
                </button>
                <button className="icon-btn" title="Delete" onClick={() => remove(e)}>
                  <span className="material-icons-round">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="fab" onClick={startNew}><span className="material-icons-round">add</span></button>

      {editingOpen && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 15 }}>{form.id ? 'Edit Entry' : 'Add Entry'}</h3>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Year</label>
                <input value={form.year} inputMode="numeric" maxLength={4}
                  onChange={(e) => setForm({ ...form, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
              </div>
              <div className="form-group">
                <label>Title (English)</label>
                <input value={form.title_en} onChange={(e) => setForm({ ...form, title_en: e.target.value })} placeholder="2017 — A New Beginning" />
              </div>
              <div className="form-group">
                <label>Title (Hindi)</label>
                <input value={form.title_hi} onChange={(e) => setForm({ ...form, title_hi: e.target.value })} placeholder="2017 — एक नई शुरुआत" />
              </div>
              <div className="form-group">
                <label>Content (English)</label>
                <textarea rows={4} value={form.content_en} onChange={(e) => setForm({ ...form, content_en: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Content (Hindi)</label>
                <textarea rows={4} value={form.content_hi} onChange={(e) => setForm({ ...form, content_hi: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={closeForm}>Cancel</button>
                <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
