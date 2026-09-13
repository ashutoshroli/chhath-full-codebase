import { useEffect, useState } from 'react';
import { api } from '../api.js';

// "Journey Content" — manages the public "Our Journey / 10 Years of Chhath" story:
// the bilingual tagline (portal_settings journey_tagline_en/_hi), the per-year
// entries (journey_entries), AND all the static page prose (journey_page_text_en/
// _hi — one JSON blob per language). Superadmin tool; self-contained.
const BLANK = { id: null, year: '', title_en: '', title_hi: '', content_en: '', content_hi: '' };

// The static page-text fields, grouped for the editor. `key` matches the JSON in
// portal_settings.journey_page_text_*; `area` = multiline. Some values may keep
// {placeholders} (e.g. {start}/{end}/{amount}/{count}/{year}) — leave them in.
const PAGE_TEXT_GROUPS = [
  { title: 'Intro & Origin', fields: [
    { key: 'intro', label: 'Intro paragraph', area: true },
    { key: 'origin_h', label: 'Origin — heading' },
    { key: 'origin_p1', label: 'Origin — paragraph 1', area: true },
    { key: 'origin_p2', label: 'Origin — paragraph 2', area: true },
    { key: 'origin_p3', label: 'Origin — paragraph 3', area: true },
    { key: 'origin_p4', label: 'Origin — paragraph 4', area: true },
    { key: 'journey_h', label: 'Section heading: "Our Journey"' },
  ] },
  { title: 'Portal callout & note', fields: [
    { key: 'evolution_line', label: 'Evolution line (Paper → … → Portal)' },
    { key: 'portal_h', label: 'Portal callout — heading' },
    { key: 'portal_p', label: 'Portal callout — paragraph', area: true },
    { key: 'current_note_h', label: 'Current-year note — heading (use {year})' },
    { key: 'current_note_p', label: 'Current-year note — text (use {year})', area: true },
  ] },
  { title: 'Financial table labels', fields: [
    { key: 'table_h', label: 'Table heading (use {start}/{end})' },
    { key: 'th_year', label: 'Column: Year' },
    { key: 'th_total', label: 'Column: Total' },
    { key: 'th_contributors', label: 'Column: Contributors' },
    { key: 'total_label', label: 'Year card — total label' },
    { key: 'contributors_label', label: 'Year card — contributors label' },
    { key: 'totals_h', label: 'Totals box — heading (use {start}/{end})' },
    { key: 'total_amount', label: 'Totals box — amount line (use {amount})', area: true },
    { key: 'total_entries', label: 'Totals box — entries line (use {count})', area: true },
    { key: 'total_clarify', label: 'Totals box — clarify (use {count})', area: true },
  ] },
  { title: 'Transparency timeline', fields: [
    { key: 'timeline_h', label: 'Timeline — section heading' },
    { key: 'tl_paper_h', label: 'Step 1 — heading' }, { key: 'tl_paper_d', label: 'Step 1 — text', area: true },
    { key: 'tl_pdf_h', label: 'Step 2 — heading' }, { key: 'tl_pdf_d', label: 'Step 2 — text', area: true },
    { key: 'tl_wa_h', label: 'Step 3 — heading' }, { key: 'tl_wa_d', label: 'Step 3 — text', area: true },
    { key: 'tl_sheets_h', label: 'Step 4 — heading' }, { key: 'tl_sheets_d', label: 'Step 4 — text', area: true },
    { key: 'tl_portal_h', label: 'Step 5 — heading' }, { key: 'tl_portal_d', label: 'Step 5 — text', area: true },
  ] },
  { title: 'Our Thinking & milestones', fields: [
    { key: 'think_h', label: 'Our Thinking — heading' },
    { key: 'think_lead', label: 'Our Thinking — lead' },
    { key: 'think_p', label: 'Our Thinking — paragraph', area: true },
    { key: 'ms_2017_h', label: 'Milestone 2017 — heading' }, { key: 'ms_2017_d', label: 'Milestone 2017 — text', area: true },
    { key: 'ms_2021_h', label: 'Milestone 2021 — heading' }, { key: 'ms_2021_d', label: 'Milestone 2021 — text', area: true },
    { key: 'ms_2026_h', label: 'Milestone 2026 — heading' }, { key: 'ms_2026_d', label: 'Milestone 2026 — text', area: true },
  ] },
  { title: 'Closing & footer', fields: [
    { key: 'closing_h', label: 'Closing — heading' },
    { key: 'closing_p1', label: 'Closing — paragraph 1', area: true },
    { key: 'closing_p2', label: 'Closing — paragraph 2', area: true },
    { key: 'closing_p3', label: 'Closing — paragraph 3', area: true },
    { key: 'footer', label: 'Footer line' },
  ] },
];

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

  // Page text (two JSON blobs: en / hi)
  const [textEn, setTextEn] = useState({});
  const [textHi, setTextHi] = useState({});
  const [textLang, setTextLang] = useState('en'); // which language the editor shows
  const [textSaving, setTextSaving] = useState(false);
  const [textMsg, setTextMsg] = useState('');

  const parseJson = (v) => { try { return v ? JSON.parse(v) : {}; } catch { return {}; } };
  const textVal = (key) => (textLang === 'hi' ? textHi : textEn)[key] || '';
  const setTextVal = (key, val) =>
    (textLang === 'hi' ? setTextHi : setTextEn)((prev) => ({ ...prev, [key]: val }));

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
    Promise.all([api.getPortalSetting('journey_page_text_en'), api.getPortalSetting('journey_page_text_hi')])
      .then(([en, hi]) => { setTextEn(parseJson(en && en.value)); setTextHi(parseJson(hi && hi.value)); })
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

  const savePageText = async (ev) => {
    ev.preventDefault();
    setTextSaving(true);
    setTextMsg('');
    try {
      // Persist BOTH languages (the editor toggles which one is shown, but both
      // states are kept in memory), as compact JSON blobs.
      await api.setPortalSetting('journey_page_text_en', JSON.stringify(textEn));
      await api.setPortalSetting('journey_page_text_hi', JSON.stringify(textHi));
      setTextMsg('Saved.');
    } catch (err) {
      alert(err.message);
    } finally {
      setTextSaving(false);
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

      {/* Page text editor (all the static prose) */}
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Page Text</h3>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            <button type="button" className={textLang === 'en' ? 'btn-submit' : 'btn-secondary'} style={{ padding: '4px 12px' }} onClick={() => setTextLang('en')}>English</button>
            <button type="button" className={textLang === 'hi' ? 'btn-submit' : 'btn-secondary'} style={{ padding: '4px 12px' }} onClick={() => setTextLang('hi')}>हिंदी</button>
          </div>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>
          Editing <strong>{textLang === 'hi' ? 'Hindi' : 'English'}</strong>. Leave a field blank to fall back to the built-in text. Keep any {'{placeholders}'} (e.g. {'{start}'}, {'{amount}'}, {'{year}'}).
        </p>
        <form onSubmit={savePageText}>
          {PAGE_TEXT_GROUPS.map((g) => (
            <details key={g.title} style={{ marginBottom: 10, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: '8px 12px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}>{g.title}</summary>
              <div style={{ marginTop: 8 }}>
                {g.fields.map((f) => (
                  <div className="form-group" key={f.key}>
                    <label>{f.label}</label>
                    {f.area
                      ? <textarea rows={3} value={textVal(f.key)} onChange={(e) => setTextVal(f.key, e.target.value)} />
                      : <input value={textVal(f.key)} onChange={(e) => setTextVal(f.key, e.target.value)} />}
                  </div>
                ))}
              </div>
            </details>
          ))}
          <button className="btn-submit" disabled={textSaving}>{textSaving ? 'Saving...' : 'Save Page Text'}</button>
          {textMsg && <span style={{ marginLeft: 10, color: 'var(--success)', fontSize: '0.85rem' }}>{textMsg}</span>}
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
