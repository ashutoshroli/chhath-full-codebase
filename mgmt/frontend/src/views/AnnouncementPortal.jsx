import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { isTruthyFlag } from '../flags.js';

function fmtDateTimeLocal(d) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AnnouncementPortal({ years }) {
  const [year, setYear] = useState((years && years[0]) || '');
  const [pin, setPin] = useState('');
  const [neverExpires, setNeverExpires] = useState(true);
  const [expiresAt, setExpiresAt] = useState(fmtDateTimeLocal(new Date(Date.now() + 6 * 60 * 60 * 1000)));
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState(null);
  const [links, setLinks] = useState([]);
  const [error, setError] = useState('');

  const [customs, setCustoms] = useState([]);
  const [customYear, setCustomYear] = useState((years && years[0]) || '');
  const [textHindi, setTextHindi] = useState('');
  const [textEnglish, setTextEnglish] = useState('');
  const [priority, setPriority] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [savingCustom, setSavingCustom] = useState(false);

  useEffect(() => { if (years && years.length && !year) setYear(years[0]); if (years && years.length && !customYear) setCustomYear(years[0]); }, [years]); // eslint-disable-line

  const refreshLinks = () => { api.getAnnouncementLinks().then(setLinks).catch(err => setError(err.message)); };
  useEffect(() => { refreshLinks(); }, []);

  const refreshCustoms = () => {
    if (!customYear) return;
    api.getCustomAnnouncements(customYear).then(setCustoms).catch(err => setError(err.message));
  };
  useEffect(() => { refreshCustoms(); }, [customYear]); // eslint-disable-line

  const baseUrl = window.location.origin;

  const generate = async () => {
    if (!year) return setError('Please select a year');
    if (!pin || pin.trim().length < 4) return setError('PIN must be at least 4 digits');
    setGenerating(true);
    setError('');
    try {
      const res = await api.generateAnnouncementLink(year, pin.trim(), neverExpires ? null : new Date(expiresAt).toISOString());
      setGeneratedLink({ url: `${baseUrl}/announce/${res.token}`, pin: res.pin });
      setPin('');
      refreshLinks();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (token) => {
    if (!confirm('Revoke this link? It will stop working immediately.')) return;
    try {
      await api.revokeAnnouncementLink(token);
      refreshLinks();
    } catch (err) {
      setError(err.message);
    }
  };

  const copyLink = (url) => {
    // navigator.clipboard is unavailable on non-HTTPS origins and in some
    // in-app browsers, where this used to fail SILENTLY — the button just
    // appeared broken. Show the link so it can be copied by hand.
    if (!navigator.clipboard) return window.prompt('Copy this link:', url);
    navigator.clipboard.writeText(url)
      .then(() => alert('Link copied'))
      .catch(() => window.prompt('Permission to copy was not granted — please copy this link manually:', url));
  };

  const resetCustomForm = () => { setTextHindi(''); setTextEnglish(''); setPriority(false); setEditingId(null); };

  const saveCustom = async () => {
    if (!textHindi.trim() && !textEnglish.trim()) return setError('At least one of Hindi or English text is required');
    setSavingCustom(true);
    setError('');
    try {
      if (editingId) await api.updateCustomAnnouncement(editingId, textHindi.trim(), textEnglish.trim(), priority);
      else await api.addCustomAnnouncement(customYear, textHindi.trim(), textEnglish.trim(), priority);
      resetCustomForm();
      refreshCustoms();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCustom(false);
    }
  };

  const editCustom = (c) => {
    setEditingId(c.ID);
    setTextHindi(c.TextHindi || '');
    setTextEnglish(c.TextEnglish || '');
    setPriority(isTruthyFlag(c.Priority));
  };

  const deleteCustom = async (id) => {
    if (!confirm('Delete this custom announcement?')) return;
    try {
      await api.deleteCustomAnnouncement(id);
      refreshCustoms();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Announcement Portal</h2>
      {error && <div className="error-banner">{error}</div>}

      {/* ---- Generate Link ---- */}
      <div className="glass-card" style={{ padding: 15 }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>Generate New Link</strong>
        <div className="form-group">
          <label>Year</label>
          <select value={year} onChange={e => setYear(e.target.value)}>
            {(years || []).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>PIN (minimum 4 digits)</label>
          <input type="text" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} placeholder="e.g. 4821" />
        </div>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={neverExpires} onChange={e => setNeverExpires(e.target.checked)} />
            Never expires
          </label>
        </div>
        {!neverExpires && (
          <div className="form-group">
            <label>Expiry Date/Time</label>
            <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
          </div>
        )}
        <button className="btn-submit" onClick={generate} disabled={generating}>
          {generating ? 'Generating...' : 'Generate Link'}
        </button>

        {generatedLink && (
          <div style={{ marginTop: 15, padding: 12, background: '#F0FDF4', borderRadius: 8, border: '1px solid #BBF7D0' }}>
            <div style={{ fontSize: '0.85rem', marginBottom: 6 }}><strong>Link:</strong> <span style={{ wordBreak: 'break-all' }}>{generatedLink.url}</span></div>
            <div style={{ fontSize: '0.85rem', marginBottom: 10 }}><strong>PIN:</strong> {generatedLink.pin}</div>
            <button className="btn-submit" style={{ width: 'auto' }} onClick={() => copyLink(generatedLink.url)}>Copy Link</button>
          </div>
        )}
      </div>

      {/* ---- Existing Links ---- */}
      <div className="glass-card" style={{ padding: 15 }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>Existing Links</strong>
        {links.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No links have been created yet.</p>}
        {links.map(l => (
          <div key={l.Token} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #eee', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600 }}>Year {l.Year} <span style={{
                marginLeft: 8, fontSize: '0.7rem', padding: '2px 8px', borderRadius: 12,
                background: l.status === 'active' ? '#D1FAE5' : l.status === 'expired' ? '#FEF3C7' : '#FEE2E2',
                color: l.status === 'active' ? '#065F46' : l.status === 'expired' ? '#92400E' : '#991B1B',
              }}>{l.status}</span></div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {l.ExpiresAt ? `Expires: ${new Date(l.ExpiresAt).toLocaleString('en-IN')}` : 'Never expires'} · By {l.CreatedBy}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={() => copyLink(`${baseUrl}/announce/${l.Token}`)}>Copy Link</button>
              {l.status !== 'revoked' && <button className="btn-danger" onClick={() => revoke(l.Token)}>Revoke</button>}
            </div>
          </div>
        ))}
      </div>

      {/* ---- Custom Announcements ---- */}
      <div className="glass-card" style={{ padding: 15 }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>Custom Announcements</strong>
        <div className="form-group">
          <label>Year</label>
          <select value={customYear} onChange={e => setCustomYear(e.target.value)}>
            {(years || []).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Text (Hindi)</label>
          <textarea rows={2} value={textHindi} onChange={e => setTextHindi(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd' }} />
        </div>
        <div className="form-group">
          <label>Text (English)</label>
          <textarea rows={2} value={textEnglish} onChange={e => setTextEnglish(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd' }} />
        </div>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={priority} onChange={e => setPriority(e.target.checked)} />
            Priority (interrupts the queue to display immediately)
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-submit" style={{ width: 'auto' }} onClick={saveCustom} disabled={savingCustom}>
            {editingId ? 'Update' : 'Add'}
          </button>
          {editingId && <button className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={resetCustomForm}>Cancel</button>}
        </div>

        <div style={{ marginTop: 15 }}>
          {customs.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No custom announcements for this year.</p>}
          {customs.map(c => (
            <div key={c.ID} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #eee', gap: 10 }}>
              <div style={{ flex: 1 }}>
                {(isTruthyFlag(c.Priority)) && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 12, background: '#FEF3C7', color: '#92400E', marginRight: 6 }}>Priority</span>
                )}
                {c.TextHindi && <div style={{ fontSize: '0.9rem' }}>{c.TextHindi}</div>}
                {c.TextEnglish && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{c.TextEnglish}</div>}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Announced: {c.AnnouncedCount || 0}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={() => editCustom(c)}>Edit</button>
                <button className="btn-danger" onClick={() => deleteCustom(c.ID)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
