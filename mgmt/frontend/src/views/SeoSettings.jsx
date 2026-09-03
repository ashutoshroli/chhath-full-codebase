import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';
import { prepareImageForUpload } from '../imagePrep.js';

// SEO & Link Preview (Superadmin).
//
// One place to control how BOTH portals appear when their links are shared
// (WhatsApp, Facebook, X) or indexed by search engines: the title, description,
// keywords and preview image. Values are saved to the server; pressing
// "Publish" then rebuilds the chosen portal so the new values are baked into its
// HTML (social crawlers read only the served HTML, so a rebuild is what actually
// updates a link preview).

const str = (v) => (v === undefined || v === null ? '' : v.toString());

const EMPTY = {
  public: { title: '', description: '', keywords: '', image: '' },
  mgmt: { title: '', description: '', image: '' },
  deployHooks: { publicConfigured: false, mgmtConfigured: false },
};

// A small card that mimics how a shared link looks in a chat/social feed, so the
// Superadmin can see the result before publishing.
function PreviewCard({ image, title, description, domain }) {
  return (
    <div style={{
      border: '1px solid var(--border, #e2e2e2)', borderRadius: 10, overflow: 'hidden',
      maxWidth: 420, background: 'var(--surface, #fff)',
    }}>
      <div style={{
        width: '100%', aspectRatio: '1200 / 630', background: '#f0f0f0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {image
          ? <img src={image} alt="Link preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>No preview image</span>}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted, #888)' }}>{domain}</div>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', margin: '2px 0' }}>
          {title || 'Untitled'}
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted, #666)' }}>
          {description || 'No description set.'}
        </div>
      </div>
    </div>
  );
}

export default function SeoSettings() {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState('');
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Deploy-hook URLs are write-only from the UI: we never receive the saved URL
  // back (only whether one is configured), so these inputs stay blank unless the
  // Superadmin is entering/changing a hook.
  const [publicHook, setPublicHook] = useState('');
  const [mgmtHook, setMgmtHook] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getSeoSettings();
      setData({
        public: { ...EMPTY.public, ...(res.public || {}) },
        mgmt: { ...EMPTY.mgmt, ...(res.mgmt || {}) },
        deployHooks: { ...EMPTY.deployHooks, ...(res.deployHooks || {}) },
      });
    } catch (err) {
      setError(err.message || 'Failed to load SEO settings.');
      reportClientError('SeoSettings', 'Failed to load SEO settings', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setPublic = (patch) => setData(d => ({ ...d, public: { ...d.public, ...patch } }));
  const setMgmt = (patch) => setData(d => ({ ...d, mgmt: { ...d.mgmt, ...patch } }));

  const uploadImage = async (portal, file) => {
    if (!file) return;
    setUploading(portal);
    setError('');
    setNotice('');
    try {
      // Downscale + convert in the browser (same helper as popup images), so a
      // large phone photo or an iPhone HEIC never reaches the Worker as-is.
      const prepped = await prepareImageForUpload(file);
      const res = await api.uploadSeoImage(prepped.base64, prepped.fileName);
      const imageUrl = res.imageUrl || res.url;
      if (!imageUrl) throw new Error('The server did not return an image URL.');
      if (portal === 'public') setPublic({ image: imageUrl });
      else setMgmt({ image: imageUrl });
      setNotice('Image uploaded. Remember to Save, then Publish.');
    } catch (err) {
      setError(`Image upload failed: ${err.message}`);
      reportClientError('SeoSettings', 'SEO image upload failed', err, {
        portal, fileName: file.name, fileType: file.type, fileSize: file.size,
      });
    } finally {
      setUploading('');
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        public: {
          title: str(data.public.title).trim(),
          description: str(data.public.description).trim(),
          keywords: str(data.public.keywords).trim(),
          image: str(data.public.image).trim(),
        },
        mgmt: {
          title: str(data.mgmt.title).trim(),
          description: str(data.mgmt.description).trim(),
          image: str(data.mgmt.image).trim(),
        },
        deployHooks: {},
      };
      // Only send a hook URL when one was actually typed; a blank field keeps the
      // existing hook on the server.
      if (publicHook.trim()) payload.deployHooks.publicUrl = publicHook.trim();
      if (mgmtHook.trim()) payload.deployHooks.mgmtUrl = mgmtHook.trim();

      await api.saveSeoSettings(payload);
      setPublicHook('');
      setMgmtHook('');
      setNotice('Settings saved. Press "Publish" to rebuild a portal and apply the new link preview.');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to save settings.');
      reportClientError('SeoSettings', 'Failed to save SEO settings', err);
    } finally {
      setSaving(false);
    }
  };

  const publish = async (target) => {
    setPublishing(target);
    setError('');
    setNotice('');
    try {
      const res = await api.triggerRebuild(target);
      if (res.success) {
        setNotice('Rebuild started. The new link preview will be live in about 1-2 minutes.');
      } else {
        const reasons = Object.entries(res.results || {})
          .filter(([, r]) => !r.triggered)
          .map(([p, r]) => `${p}: ${r.reason || 'not triggered'}`)
          .join('; ');
        setError(`Could not start the rebuild. ${reasons || 'Check that a deploy hook is configured.'}`);
      }
    } catch (err) {
      setError(err.message || 'Failed to trigger the rebuild.');
      reportClientError('SeoSettings', 'Failed to trigger rebuild', err);
    } finally {
      setPublishing('');
    }
  };

  if (loading) return <div className="inline-spinner">Loading...</div>;

  const inputStyle = { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: '0.9rem', marginBottom: 12 };
  const labelStyle = { fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 5 };
  const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' });

  return (
    <div>
      <h2 style={{ marginBottom: 6 }}>SEO &amp; Link Preview</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 16 }}>
        Control how each portal appears in search engines and when its link is shared
        (WhatsApp, Facebook, X). Save your changes, then press <strong>Publish</strong> to
        rebuild a portal so the new preview goes live.
      </p>

      {error && <div className="glass-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 12, padding: 12 }}>{error}</div>}
      {notice && <div className="glass-card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 12, padding: 12 }}>{notice}</div>}

      {/* ---- Public portal ---- */}
      <div className="glass-card" style={{ marginBottom: 18, padding: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Public Portal — chhath.shaharpura.com</h3>

        <label style={labelStyle}>Title</label>
        <input style={inputStyle} value={data.public.title} onChange={e => setPublic({ title: e.target.value })} placeholder="Navyuvak Chhath Puja Samiti Shaharpura" />

        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={data.public.description} onChange={e => setPublic({ description: e.target.value })} placeholder="Short summary shown under the title in search results and link previews." />

        <label style={labelStyle}>Keywords (comma separated)</label>
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={data.public.keywords} onChange={e => setPublic({ keywords: e.target.value })} placeholder="Chhath Puja, Shaharpura, Gardih, Giridih, Jharkhand, ..." />

        <label style={labelStyle}>Preview Image (recommended 1200 × 630)</label>
        <input type="file" accept="image/*" onChange={e => uploadImage('public', e.target.files[0])} disabled={uploading === 'public'} style={{ marginBottom: 12 }} />
        {uploading === 'public' && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>Uploading...</div>}

        <div style={{ marginTop: 8 }}>
          <div style={labelStyle}>Preview</div>
          <PreviewCard image={data.public.image} title={data.public.title} description={data.public.description} domain="chhath.shaharpura.com" />
        </div>
      </div>

      {/* ---- Management portal ---- */}
      <div className="glass-card" style={{ marginBottom: 18, padding: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Management Portal — mgmt-chhath.shaharpura.com</h3>

        <label style={labelStyle}>Title</label>
        <input style={inputStyle} value={data.mgmt.title} onChange={e => setMgmt({ title: e.target.value })} placeholder="Chhath Puja Management Portal" />

        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={data.mgmt.description} onChange={e => setMgmt({ description: e.target.value })} placeholder="Short summary for the management portal link preview." />

        <label style={labelStyle}>Preview Image (recommended 1200 × 630)</label>
        <input type="file" accept="image/*" onChange={e => uploadImage('mgmt', e.target.files[0])} disabled={uploading === 'mgmt'} style={{ marginBottom: 12 }} />
        {uploading === 'mgmt' && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>Uploading...</div>}

        <div style={{ marginTop: 8 }}>
          <div style={labelStyle}>Preview</div>
          <PreviewCard image={data.mgmt.image} title={data.mgmt.title} description={data.mgmt.description} domain="mgmt-chhath.shaharpura.com" />
        </div>
      </div>

      {/* ---- Deploy hooks ---- */}
      <div className="glass-card" style={{ marginBottom: 18, padding: 16 }}>
        <h3 style={{ marginBottom: 6 }}>Deploy Hooks</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          A one-time setup. Paste the Vercel Deploy Hook URL for each portal so the
          Publish buttons can rebuild it. Leave a field blank to keep the existing hook.
        </p>

        <label style={labelStyle}>
          Public portal hook {data.deployHooks.publicConfigured && <span style={{ color: 'var(--success)' }}>(configured)</span>}
        </label>
        <input style={inputStyle} value={publicHook} onChange={e => setPublicHook(e.target.value)} placeholder="https://api.vercel.com/v1/integrations/deploy/..." />

        <label style={labelStyle}>
          Management portal hook {data.deployHooks.mgmtConfigured && <span style={{ color: 'var(--success)' }}>(configured)</span>}
        </label>
        <input style={inputStyle} value={mgmtHook} onChange={e => setMgmtHook(e.target.value)} placeholder="https://api.vercel.com/v1/integrations/deploy/..." />
      </div>

      {/* ---- Actions ---- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button style={btn('var(--primary-saffron, #F97316)')} onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <button style={btn('#2563eb')} onClick={() => publish('public')} disabled={!!publishing || !data.deployHooks.publicConfigured}>
          {publishing === 'public' ? 'Publishing...' : 'Publish Public Portal'}
        </button>
        <button style={btn('#2563eb')} onClick={() => publish('mgmt')} disabled={!!publishing || !data.deployHooks.mgmtConfigured}>
          {publishing === 'mgmt' ? 'Publishing...' : 'Publish Management Portal'}
        </button>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 10 }}>
        Save stores your changes instantly. Publish rebuilds a portal (about 1-2 minutes)
        so the new link preview and search tags take effect.
      </p>
    </div>
  );
}
