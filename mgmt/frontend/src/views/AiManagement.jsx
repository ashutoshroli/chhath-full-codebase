import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';

// AI Management (Superadmin-only). Add multiple AI providers — each with its own
// API key, base URL and model — and pick a DEFAULT. The AI-fix engine uses the
// default; if none is set (or its key is unusable) it falls back to the
// ANTHROPIC_API_KEY Cloudflare secret, so AI-fix keeps working no matter what.
//
// SECURITY: the API key is sent to the backend only when set/changed; it is
// stored encrypted and the backend NEVER returns it. The list shows a masked
// hint only. "Test" runs on the backend — the key never reaches this screen.

const TYPES = [
  { value: 'anthropic', label: 'Anthropic (Claude — native)' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (OpenAI / OpenRouter / Groq / DeepSeek / Gemini / local)' },
];

const BLANK = { providerId: null, name: '', type: 'openai-compatible', baseUrl: '', model: '', apiKey: '' };

export default function AiManagement() {
  const [providers, setProviders] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // null = not editing; object = add/edit form
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState({}); // providerId -> { ok, message }
  const [busyId, setBusyId] = useState(null);

  const refresh = () => {
    api.getAiProviders()
      .then(setProviders)
      .catch(err => { setProviders([]); setError(err.message); });
  };
  useEffect(() => { refresh(); }, []);

  const startAdd = () => { setError(''); setForm({ ...BLANK }); };
  const startEdit = (p) => {
    setError('');
    // apiKey left blank on edit = keep existing key.
    setForm({ providerId: p.provider_id, name: p.name, type: p.type, baseUrl: p.base_url || '', model: p.model || '', apiKey: '' });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (!form.name.trim()) throw new Error('Enter a name');
      if (!form.model.trim()) throw new Error('Enter a model');
      if (form.type === 'openai-compatible' && !/^https?:\/\//.test(form.baseUrl.trim())) {
        throw new Error('Enter a base URL like https://api.openai.com/v1');
      }
      if (!form.providerId && !form.apiKey.trim()) throw new Error('Enter the API key');
      await api.saveAiProvider({
        providerId: form.providerId || undefined,
        name: form.name.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        // Only send the key if the user typed one (blank on edit = keep existing).
        ...(form.apiKey.trim() ? { apiKey: form.apiKey } : {}),
      });
      setForm(null);
      refresh();
    } catch (err) {
      setError(err.message);
      reportClientError('AiManagement', 'saveAiProvider failed', err, {});
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!confirm(`Delete provider "${p.name}"? If it was the default, AI-fix falls back to the ANTHROPIC_API_KEY secret.`)) return;
    try { await api.deleteAiProvider(p.provider_id); refresh(); }
    catch (err) { alert(err.message); }
  };

  const makeDefault = async (providerId) => {
    setBusyId(providerId);
    try { await api.setDefaultAiProvider(providerId); refresh(); }
    catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  };

  const clearDefault = async () => {
    setBusyId('__clear__');
    try { await api.setDefaultAiProvider(''); refresh(); }
    catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  };

  const test = async (providerId) => {
    setBusyId('test:' + providerId);
    setTestResult(r => ({ ...r, [providerId]: null }));
    try {
      const res = await api.testAiProvider(providerId);
      setTestResult(r => ({ ...r, [providerId]: { ok: !!res.ok, message: res.message || (res.ok ? 'OK' : 'Failed') } }));
    } catch (err) {
      setTestResult(r => ({ ...r, [providerId]: { ok: false, message: err.message } }));
    } finally {
      setBusyId(null);
    }
  };

  const anyDefault = (providers || []).some(p => p.is_default);

  if (form) {
    return (
      <>
        <h2 style={{ marginBottom: 12 }}>{form.providerId ? 'Edit AI Provider' : 'Add AI Provider'}</h2>
        {error && <div className="error-banner">{error}</div>}
        <div className="glass-card" style={{ padding: 15, marginBottom: 15 }}>
          <div className="form-group">
            <label>Name (for your reference)</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. OpenAI GPT-4o" />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {form.type === 'openai-compatible' && (
            <div className="form-group">
              <label>Base URL</label>
              <input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                OpenAI: <code>https://api.openai.com/v1</code> · OpenRouter: <code>https://openrouter.ai/api/v1</code> · Groq: <code>https://api.groq.com/openai/v1</code> · Gemini: <code>https://generativelanguage.googleapis.com/v1beta/openai</code>
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Model</label>
            <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="e.g. gpt-4o, claude-sonnet-4-5, google/gemini-2.0-flash" />
          </div>
          <div className="form-group">
            <label>API key {form.providerId ? '(leave blank to keep the existing key)' : ''}</label>
            <input type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder={form.providerId ? '•••••••• (unchanged)' : 'Paste the API key'} autoComplete="off" />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Stored encrypted on the server (AES-GCM). It is never shown again or sent back to this screen.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-submit" style={{ width: 'auto' }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={() => setForm(null)}>Cancel</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>AI Management</h2>
        <button className="btn-submit" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem' }} onClick={startAdd}>+ Add Provider</button>
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        The <strong>default</strong> provider is used for the Error Log "Fix using AI" feature.
        With no default set, it falls back to the <code>ANTHROPIC_API_KEY</code> server secret.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {!anyDefault && (
        <div style={{ background: '#DBEAFE', color: '#1E40AF', borderRadius: 8, padding: '8px 10px', fontSize: '0.8rem', marginBottom: 12 }}>
          No default selected → AI-fix uses the built-in <strong>ANTHROPIC_API_KEY</strong> secret.
        </div>
      )}

      {!providers && <div className="inline-spinner">Loading…</div>}
      {providers && providers.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>
          No providers added. AI-fix uses the ANTHROPIC_API_KEY secret until you add one.
        </div>
      )}

      {(providers || []).map(p => {
        const tr = testResult[p.provider_id];
        return (
          <div className="glass-card" key={p.provider_id} style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{p.name}</strong>
                {p.is_default && <span className="badge badge-ok" style={{ marginLeft: 8 }}>Default</span>}
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {p.type} · model: <code>{p.model || '—'}</code>{p.base_url ? <> · {p.base_url}</> : null}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Key: {p.has_key ? p.key_hint || '••••••••' : '(none)'}</div>
                {tr && (
                  <div style={{ fontSize: '0.75rem', marginTop: 4, color: tr.ok ? 'var(--success, #166534)' : 'var(--danger, #b91c1c)' }}>
                    {tr.ok ? '✓ ' : '✗ '}{tr.message}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className="btn-submit" style={{ width: 'auto', padding: '4px 10px', fontSize: '0.72rem', background: '#e5e7eb', color: '#111' }} onClick={() => test(p.provider_id)} disabled={busyId === 'test:' + p.provider_id}>
                  {busyId === 'test:' + p.provider_id ? 'Testing…' : 'Test'}
                </button>
                {!p.is_default && (
                  <button type="button" className="btn-submit" style={{ width: 'auto', padding: '4px 10px', fontSize: '0.72rem' }} onClick={() => makeDefault(p.provider_id)} disabled={busyId === p.provider_id}>
                    Set default
                  </button>
                )}
                <button type="button" className="btn-submit" style={{ width: 'auto', padding: '4px 10px', fontSize: '0.72rem', background: '#e5e7eb', color: '#111' }} onClick={() => startEdit(p)}>Edit</button>
                <button type="button" className="btn-submit" style={{ width: 'auto', padding: '4px 10px', fontSize: '0.72rem', background: '#fee2e2', color: '#991b1b' }} onClick={() => remove(p)}>Delete</button>
              </div>
            </div>
          </div>
        );
      })}

      {anyDefault && (
        <button type="button" className="btn-submit" style={{ width: 'auto', marginTop: 6, padding: '5px 12px', fontSize: '0.75rem', background: '#e5e7eb', color: '#111' }} onClick={clearDefault} disabled={busyId === '__clear__'}>
          Clear default (use ANTHROPIC_API_KEY secret)
        </button>
      )}
    </>
  );
}
