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

// What the provider is used for. 'fix' = Error Log "Fix using AI"; 'public_chat'
// = the public portal chatbot. Each purpose has its own default.
const PURPOSES = [
  { value: 'fix', label: 'AI Fixes (Error Log “Fix using AI”)' },
  { value: 'public_chat', label: 'Public Chatbot (public portal)' },
];
const purposeLabel = (p) => (PURPOSES.find(x => x.value === p) || PURPOSES[0]).label;

const BLANK = { providerId: null, name: '', type: 'openai-compatible', baseUrl: '', model: '', apiKey: '', purpose: 'fix' };

export default function AiManagement() {
  const [providers, setProviders] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // null = not editing; object = add/edit form
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState({}); // providerId -> { ok, message, reply? }
  const [busyId, setBusyId] = useState(null);
  const [promptOpen, setPromptOpen] = useState({}); // providerId -> bool (custom-prompt box shown)
  const [promptText, setPromptText] = useState({}); // providerId -> string

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
    setForm({ providerId: p.provider_id, name: p.name, type: p.type, baseUrl: p.base_url || '', model: p.model || '', apiKey: '', purpose: p.purpose || 'fix' });
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
        purpose: form.purpose || 'fix',
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

  // Move a provider up/down within its purpose's fallback order (dir = -1 up / +1 down).
  const move = async (p, dir) => {
    const purpose = p.purpose || 'fix';
    const group = (providers || []).filter(x => (x.purpose || 'fix') === purpose);
    const idx = group.findIndex(x => x.provider_id === p.provider_id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= group.length) return; // already at the edge
    const ids = group.map(x => x.provider_id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]]; // swap
    setBusyId('move:' + p.provider_id);
    try { await api.reorderAiProviders(purpose, ids); refresh(); }
    catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  };

  const clearDefault = async () => {
    setBusyId('__clear__');
    // Clears the FIX default only (that's the one with the ANTHROPIC_API_KEY
    // fallback). The public_chat default, if any, is left alone.
    try { await api.setDefaultAiProvider('', 'fix'); refresh(); }
    catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  };

  // `prompt` empty/undefined -> quick connectivity ping; non-empty -> exercise the
  // model and show its reply. maxTokens is capped server-side (1024).
  const test = async (providerId, prompt) => {
    const custom = (prompt || '').trim();
    setBusyId('test:' + providerId);
    setTestResult(r => ({ ...r, [providerId]: null }));
    try {
      const res = await api.testAiProvider(providerId, custom || undefined);
      const viaNote = res.via === 'render' ? ' (via Render)' : '';
      setTestResult(r => ({ ...r, [providerId]: {
        ok: !!res.ok,
        message: (res.message || (res.ok ? 'OK' : 'Failed')) + (res.message && res.message.includes('Render') ? '' : viaNote),
        reply: res.reply || '',
      } }));
    } catch (err) {
      setTestResult(r => ({ ...r, [providerId]: { ok: false, message: err.message } }));
    } finally {
      setBusyId(null);
    }
  };

  // The ANTHROPIC_API_KEY fallback banner is about the FIX purpose specifically.
  const anyFixDefault = (providers || []).some(p => p.is_default && (p.purpose || 'fix') === 'fix');

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
          <div className="form-group">
            <label>Use for</label>
            <select value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}>
              {PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
              “AI Fixes” powers the Error Log fixer. “Public Chatbot” answers questions on the public portal. Each has its own default.
            </div>
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
        Add multiple providers per use. They are tried in <strong>priority order</strong> (#1 first) — if one is
        rate-limited or down, the next is used automatically. Use <strong>↑ / ↓</strong> to set the order.
        AI-Fixes falls back to the <code>ANTHROPIC_API_KEY</code> server secret if none is set.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {!anyFixDefault && (
        <div style={{ background: '#DBEAFE', color: '#1E40AF', borderRadius: 8, padding: '8px 10px', fontSize: '0.8rem', marginBottom: 12 }}>
          No AI-Fixes default selected → AI-fix uses the built-in <strong>ANTHROPIC_API_KEY</strong> secret.
        </div>
      )}

      {!providers && <div className="inline-spinner">Loading…</div>}
      {providers && providers.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>
          No providers added. AI-fix uses the ANTHROPIC_API_KEY secret until you add one.
        </div>
      )}

      {(providers || []).map((p, i) => {
        const tr = testResult[p.provider_id];
        const purpose = p.purpose || 'fix';
        // Rank of this provider within its purpose (1-based) + a purpose header on
        // the first row of each purpose. providers[] is already sorted by
        // purpose, priority from the backend.
        const sameBefore = (providers || []).slice(0, i).filter(x => (x.purpose || 'fix') === purpose).length;
        const sameTotal = (providers || []).filter(x => (x.purpose || 'fix') === purpose).length;
        const rank = sameBefore + 1;
        const isFirstOfPurpose = sameBefore === 0;
        const busyMove = busyId === 'move:' + p.provider_id;
        return (
          <div key={p.provider_id}>
          {isFirstOfPurpose && (
            <h4 style={{ margin: '14px 0 6px', fontSize: '0.9rem' }}>{purposeLabel(purpose)}</h4>
          )}
          <div className="glass-card" style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <span className="badge" style={{ marginRight: 8, background: rank === 1 ? '#dcfce7' : '#f3f4f6', color: rank === 1 ? '#166534' : '#6b7280' }}>
                  #{rank}{rank === 1 ? ' primary' : ' fallback'}
                </span>
                <strong>{p.name}</strong>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {p.type} · model: <code>{p.model || '—'}</code>{p.base_url ? <> · {p.base_url}</> : null}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Used for: {purposeLabel(p.purpose)}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Key: {p.has_key ? p.key_hint || '••••••••' : '(none)'}</div>
                {busyId === 'test:' + p.provider_id && (
                  <div style={{ fontSize: '0.72rem', marginTop: 4, color: 'var(--text-muted)' }}>
                    Testing… slow models can take a while (offloaded to Render — no 30s limit).
                  </div>
                )}
                {tr && (
                  <div style={{ fontSize: '0.75rem', marginTop: 4, color: tr.ok ? 'var(--success, #166534)' : 'var(--danger, #b91c1c)' }}>
                    {tr.ok ? '✓ ' : '✗ '}{tr.message}
                  </div>
                )}
                {tr && tr.reply && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2 }}>Model reply:</div>
                    <pre style={{
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: '8px 10px',
                      background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6,
                      fontSize: '0.75rem', maxHeight: 220, overflowY: 'auto',
                    }}>{tr.reply}</pre>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className="btn-submit" title="Move up (higher priority)" style={{ width: 'auto', padding: '4px 9px', fontSize: '0.72rem', background: '#e5e7eb', color: '#111' }} onClick={() => move(p, -1)} disabled={rank === 1 || busyMove}>↑</button>
                <button type="button" className="btn-submit" title="Move down (lower priority)" style={{ width: 'auto', padding: '4px 9px', fontSize: '0.72rem', background: '#e5e7eb', color: '#111' }} onClick={() => move(p, +1)} disabled={rank === sameTotal || busyMove}>↓</button>
                <button type="button" className="btn-submit" style={{ width: 'auto', padding: '4px 10px', fontSize: '0.72rem', background: '#e5e7eb', color: '#111' }} onClick={() => test(p.provider_id)} disabled={busyId === 'test:' + p.provider_id}>
                  {busyId === 'test:' + p.provider_id ? 'Testing…' : 'Test'}
                </button>
                <button type="button" className="btn-submit" style={{ width: 'auto', padding: '4px 10px', fontSize: '0.72rem', background: promptOpen[p.provider_id] ? '#dbeafe' : '#e5e7eb', color: '#111' }} onClick={() => setPromptOpen(o => ({ ...o, [p.provider_id]: !o[p.provider_id] }))}>
                  {promptOpen[p.provider_id] ? 'Hide prompt' : 'Custom prompt'}
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

            {promptOpen[p.provider_id] && (
              <div style={{ marginTop: 10, borderTop: '1px solid #eef0f2', paddingTop: 10 }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Custom test prompt — sends this to the model and shows its reply (max 256 tokens back).
                </label>
                <textarea
                  value={promptText[p.provider_id] || ''}
                  onChange={e => setPromptText(t => ({ ...t, [p.provider_id]: e.target.value }))}
                  placeholder="e.g. Reply with a one-line JSON: {&quot;status&quot;:&quot;ok&quot;}"
                  rows={3}
                  style={{ width: '100%', marginTop: 4, fontSize: '0.8rem', fontFamily: 'inherit', padding: 8, borderRadius: 6, border: '1px solid #d1d5db', boxSizing: 'border-box' }}
                />
                <button
                  type="button"
                  className="btn-submit"
                  style={{ width: 'auto', marginTop: 6, padding: '5px 12px', fontSize: '0.75rem' }}
                  onClick={() => test(p.provider_id, promptText[p.provider_id])}
                  disabled={busyId === 'test:' + p.provider_id || !(promptText[p.provider_id] || '').trim()}
                >
                  {busyId === 'test:' + p.provider_id ? 'Sending…' : 'Send prompt'}
                </button>
              </div>
            )}
          </div>
          </div>
        );
      })}

      {anyFixDefault && (
        <button type="button" className="btn-submit" style={{ width: 'auto', marginTop: 6, padding: '5px 12px', fontSize: '0.75rem', background: '#e5e7eb', color: '#111' }} onClick={clearDefault} disabled={busyId === '__clear__'}>
          Clear AI-Fixes default (use ANTHROPIC_API_KEY secret)
        </button>
      )}
    </>
  );
}
