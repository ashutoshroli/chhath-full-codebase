<script lang="ts">
  // Ported from React views/AiManagement.jsx — CRUD for AI providers (per purpose:
  // AI-fix / public chatbot), priority ordering, set-default, test with optional
  // custom prompt, encrypted key handling.
  import { api, reportClientError } from '$lib/api';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  const TYPES = [
    { value: 'anthropic', label: 'Anthropic (Claude — native)' },
    { value: 'openai-compatible', label: 'OpenAI-compatible (OpenAI / OpenRouter / Groq / DeepSeek / Gemini / local)' }
  ];
  const PURPOSES = [
    { value: 'fix', label: 'AI Fixes (Error Log “Fix using AI”)' },
    { value: 'public_chat', label: 'Public Chatbot (public portal)' }
  ];
  const purposeLabel = (p: string) => (PURPOSES.find((x) => x.value === p) || PURPOSES[0]).label;
  const DATA_MODES = [
    { value: 'summary', label: 'Summary (fast, cheap - default)' },
    { value: 'full', label: 'Full dataset (cache-only)' }
  ];
  const BLANK = { providerId: null as string | null, name: '', type: 'openai-compatible', baseUrl: '', model: '', apiKey: '', purpose: 'fix', data_mode: 'summary' };

  let providers = $state<any[] | null>(null);
  let error = $state('');
  let form = $state<any>(null);
  let saving = $state(false);
  let testResult = $state<Record<string, any>>({});
  let busyId = $state<string | null>(null);
  let promptOpen = $state<Record<string, boolean>>({});
  let promptText = $state<Record<string, string>>({});

  function refresh() {
    api.getAiProviders()
      .then((p: any) => (providers = p))
      .catch((err: Error) => { providers = []; error = err.message; });
  }
  let started = false;
  $effect(() => { if (started) return; started = true; refresh(); });

  function startAdd() { error = ''; form = { ...BLANK }; }
  function startEdit(p: any) {
    error = '';
    form = { providerId: p.provider_id, name: p.name, type: p.type, baseUrl: p.base_url || '', model: p.model || '', apiKey: '', purpose: p.purpose || 'fix', data_mode: p.data_mode || 'summary' };
  }

  async function save() {
    saving = true;
    error = '';
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
        data_mode: form.data_mode || 'summary',
        ...(form.apiKey.trim() ? { apiKey: form.apiKey } : {})
      });
      form = null;
      refresh();
    } catch (err) {
      error = (err as Error).message;
      reportClientError('AiManagement', 'saveAiProvider failed', err as Error, {});
    } finally {
      saving = false;
    }
  }

  async function remove(p: any) {
    if (!confirm(`Delete provider "${p.name}"? If it was the default, AI-fix falls back to the ANTHROPIC_API_KEY secret.`)) return;
    try { await api.deleteAiProvider(p.provider_id); refresh(); }
    catch (err) { alert((err as Error).message); }
  }

  async function makeDefault(providerId: string) {
    busyId = providerId;
    try { await api.setDefaultAiProvider(providerId); refresh(); }
    catch (err) { alert((err as Error).message); }
    finally { busyId = null; }
  }

  async function move(p: any, dir: number) {
    const purpose = p.purpose || 'fix';
    const group = (providers || []).filter((x) => (x.purpose || 'fix') === purpose);
    const idx = group.findIndex((x) => x.provider_id === p.provider_id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= group.length) return;
    const ids = group.map((x) => x.provider_id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    busyId = 'move:' + p.provider_id;
    try { await api.reorderAiProviders(purpose, ids); refresh(); }
    catch (err) { alert((err as Error).message); }
    finally { busyId = null; }
  }

  async function clearDefault() {
    busyId = '__clear__';
    try { await api.setDefaultAiProvider('', 'fix'); refresh(); }
    catch (err) { alert((err as Error).message); }
    finally { busyId = null; }
  }

  async function test(providerId: string, prompt?: string) {
    const custom = (prompt || '').trim();
    busyId = 'test:' + providerId;
    testResult = { ...testResult, [providerId]: null };
    try {
      const res: any = await api.testAiProvider(providerId, custom || undefined);
      const viaNote = res.via === 'render' ? ' (via Render)' : '';
      testResult = { ...testResult, [providerId]: {
        ok: !!res.ok,
        message: (res.message || (res.ok ? 'OK' : 'Failed')) + (res.message && res.message.includes('Render') ? '' : viaNote),
        reply: res.reply || ''
      } };
    } catch (err) {
      testResult = { ...testResult, [providerId]: { ok: false, message: (err as Error).message } };
    } finally {
      busyId = null;
    }
  }

  let anyFixDefault = $derived((providers || []).some((p) => p.is_default && (p.purpose || 'fix') === 'fix'));
</script>

{#if form}
  <h2 style="margin-bottom:12px;">{form.providerId ? 'Edit AI Provider' : 'Add AI Provider'}</h2>
  {#if error}<div role="alert" class="error-banner">{error}</div>{/if}
  <div class="glass-card" style="padding:15px; margin-bottom:15px;">
    <div class="form-group">
      <label for={`${uid}-f1`}>Name (for your reference)</label>
      <input id={`${uid}-f1`} value={form.name} oninput={(e) => (form = { ...form, name: (e.currentTarget as HTMLInputElement).value })} placeholder="e.g. OpenAI GPT-4o" />
    </div>
    <div class="form-group">
      <label for={`${uid}-f2`}>Type</label>
      <select id={`${uid}-f2`} value={form.type} onchange={(e) => (form = { ...form, type: (e.currentTarget as HTMLSelectElement).value })}>
        {#each TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
      </select>
    </div>
    <div class="form-group">
      <label for={`${uid}-f3`}>Use for</label>
      <select id={`${uid}-f3`} value={form.purpose} onchange={(e) => (form = { ...form, purpose: (e.currentTarget as HTMLSelectElement).value })}>
        {#each PURPOSES as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
      </select>
      <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">
        “AI Fixes” powers the Error Log fixer. “Public Chatbot” answers questions on the public portal. Each has its own default.
      </div>
    </div>
    {#if form.purpose === 'public_chat'}
      <div class="form-group">
        <label for={`${uid}-f4`}>Data sent to the model</label>
        <select id={`${uid}-f4`} value={form.data_mode} onchange={(e) => (form = { ...form, data_mode: (e.currentTarget as HTMLSelectElement).value })}>
          {#each DATA_MODES as d (d.value)}<option value={d.value}>{d.label}</option>{/each}
        </select>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">
          “Summary” sends a compact computed summary (totals, top contributors, committee, per-person lookup, download links): fast, cheap and the recommended default. “Full dataset” sends the whole portal dataset, read only from the edge cache (never a live DB query), capped in size with an automatic fall back to the summary if it would be too big.
        </div>
      </div>
    {/if}
    {#if form.type === 'openai-compatible'}
      <div class="form-group">
        <label for={`${uid}-f5`}>Base URL</label>
        <input id={`${uid}-f5`} value={form.baseUrl} oninput={(e) => (form = { ...form, baseUrl: (e.currentTarget as HTMLInputElement).value })} placeholder="https://api.openai.com/v1" />
        <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">
          OpenAI: <code>https://api.openai.com/v1</code> · OpenRouter: <code>https://openrouter.ai/api/v1</code> · Groq: <code>https://api.groq.com/openai/v1</code> · Gemini: <code>https://generativelanguage.googleapis.com/v1beta/openai</code>
        </div>
      </div>
    {/if}
    <div class="form-group">
      <label for={`${uid}-f6`}>Model</label>
      <input id={`${uid}-f6`} value={form.model} oninput={(e) => (form = { ...form, model: (e.currentTarget as HTMLInputElement).value })} placeholder="e.g. gpt-4o, claude-sonnet-4-5, google/gemini-2.0-flash" />
    </div>
    <div class="form-group">
      <label for={`${uid}-f7`}>API key {form.providerId ? '(leave blank to keep the existing key)' : ''}</label>
      <input id={`${uid}-f7`} type="password" value={form.apiKey} oninput={(e) => (form = { ...form, apiKey: (e.currentTarget as HTMLInputElement).value })} placeholder={form.providerId ? '•••••••• (unchanged)' : 'Paste the API key'} autocomplete="off" />
      <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">
        Stored encrypted on the server (AES-GCM). It is never shown again or sent back to this screen.
      </div>
    </div>
  </div>
  <div style="display:flex; gap:8px;">
    <button class="btn-submit" style="width:auto;" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => (form = null)}>Cancel</button>
  </div>
{:else}
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
    <h2 style="margin:0;">AI Management</h2>
    <button class="btn-submit" style="width:auto; padding:6px 12px; font-size:0.85rem;" onclick={startAdd}>+ Add Provider</button>
  </div>
  <p style="font-size:0.78rem; color:var(--text-muted); margin-bottom:12px;">
    Add multiple providers per use. They are tried in <strong>priority order</strong> (#1 first) — if one is
    rate-limited or down, the next is used automatically. Use <strong>↑ / ↓</strong> to set the order.
    AI-Fixes falls back to the <code>ANTHROPIC_API_KEY</code> server secret if none is set.
  </p>
  {#if error}<div role="alert" class="error-banner">{error}</div>{/if}

  {#if !anyFixDefault}
    <div style="background:#DBEAFE; color:#1E40AF; border-radius:8px; padding:8px 10px; font-size:0.8rem; margin-bottom:12px;">
      No AI-Fixes default selected → AI-fix uses the built-in <strong>ANTHROPIC_API_KEY</strong> secret.
    </div>
  {/if}

  {#if !providers}<div class="inline-spinner">Loading…</div>{/if}
  {#if providers && providers.length === 0}
    <div class="glass-card" style="text-align:center; padding:20px;">
      No providers added. AI-fix uses the ANTHROPIC_API_KEY secret until you add one.
    </div>
  {/if}

  {#each providers || [] as p, i (p.provider_id)}
    {@const tr = testResult[p.provider_id]}
    {@const purpose = p.purpose || 'fix'}
    {@const sameBefore = (providers || []).slice(0, i).filter((x) => (x.purpose || 'fix') === purpose).length}
    {@const sameTotal = (providers || []).filter((x) => (x.purpose || 'fix') === purpose).length}
    {@const rank = sameBefore + 1}
    {@const isFirstOfPurpose = sameBefore === 0}
    {@const busyMove = busyId === 'move:' + p.provider_id}
    {#if isFirstOfPurpose}
      <h4 style="margin:14px 0 6px; font-size:0.9rem;">{purposeLabel(purpose)}</h4>
    {/if}
    <div class="glass-card" style="padding:14px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
        <div>
          <span class="badge" style="margin-right:8px; background:{rank === 1 ? '#dcfce7' : '#f3f4f6'}; color:{rank === 1 ? '#166534' : '#6b7280'};">
            #{rank}{rank === 1 ? ' primary' : ' fallback'}
          </span>
          <strong>{p.name}</strong>
          <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">
            {p.type} · model: <code>{p.model || '—'}</code>{#if p.base_url} · {p.base_url}{/if}
          </div>
          <div style="font-size:0.72rem; color:var(--text-muted);">Used for: {purposeLabel(p.purpose)}</div>
          <div style="font-size:0.72rem; color:var(--text-muted);">Key: {p.has_key ? p.key_hint || '••••••••' : '(none)'}</div>
          {#if busyId === 'test:' + p.provider_id}
            <div style="font-size:0.72rem; margin-top:4px; color:var(--text-muted);">
              Testing… slow models can take a while (offloaded to Render — no 30s limit).
            </div>
          {/if}
          {#if tr}
            <div style="font-size:0.75rem; margin-top:4px; color:{tr.ok ? 'var(--success, #166534)' : 'var(--danger, #b91c1c)'};">
              {tr.ok ? '✓ ' : '✗ '}{tr.message}
            </div>
          {/if}
          {#if tr && tr.reply}
            <div style="margin-top:6px;">
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:2px;">Model reply:</div>
              <pre style="white-space:pre-wrap; word-break:break-word; margin:0; padding:8px 10px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; font-size:0.75rem; max-height:220px; overflow-y:auto;">{tr.reply}</pre>
            </div>
          {/if}
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
          <button type="button" class="btn-submit" title="Move up (higher priority)" style="width:auto; padding:4px 9px; font-size:0.72rem; background:#e5e7eb; color:#111;" onclick={() => move(p, -1)} disabled={rank === 1 || busyMove}>↑</button>
          <button type="button" class="btn-submit" title="Move down (lower priority)" style="width:auto; padding:4px 9px; font-size:0.72rem; background:#e5e7eb; color:#111;" onclick={() => move(p, +1)} disabled={rank === sameTotal || busyMove}>↓</button>
          <button type="button" class="btn-submit" style="width:auto; padding:4px 10px; font-size:0.72rem; background:#e5e7eb; color:#111;" onclick={() => test(p.provider_id)} disabled={busyId === 'test:' + p.provider_id}>
            {busyId === 'test:' + p.provider_id ? 'Testing…' : 'Test'}
          </button>
          <button type="button" class="btn-submit" style="width:auto; padding:4px 10px; font-size:0.72rem; background:{promptOpen[p.provider_id] ? '#dbeafe' : '#e5e7eb'}; color:#111;" onclick={() => (promptOpen = { ...promptOpen, [p.provider_id]: !promptOpen[p.provider_id] })}>
            {promptOpen[p.provider_id] ? 'Hide prompt' : 'Custom prompt'}
          </button>
          {#if !p.is_default}
            <button type="button" class="btn-submit" style="width:auto; padding:4px 10px; font-size:0.72rem;" onclick={() => makeDefault(p.provider_id)} disabled={busyId === p.provider_id}>
              Set default
            </button>
          {/if}
          <button type="button" class="btn-submit" style="width:auto; padding:4px 10px; font-size:0.72rem; background:#e5e7eb; color:#111;" onclick={() => startEdit(p)}>Edit</button>
          <button type="button" class="btn-submit" style="width:auto; padding:4px 10px; font-size:0.72rem; background:#fee2e2; color:#991b1b;" onclick={() => remove(p)}>Delete</button>
        </div>
      </div>

      {#if promptOpen[p.provider_id]}
        <div style="margin-top:10px; border-top:1px solid #eef0f2; padding-top:10px;">
          <label for={`${uid}-prompt-${p.provider_id}`} style="font-size:0.72rem; color:var(--text-muted);">
            Custom test prompt — sends this to the model and shows its reply (max 256 tokens back).
          </label>
          <textarea
            id={`${uid}-prompt-${p.provider_id}`}
            value={promptText[p.provider_id] || ''}
            oninput={(e) => (promptText = { ...promptText, [p.provider_id]: (e.currentTarget as HTMLTextAreaElement).value })}
            placeholder={'e.g. Reply with a one-line JSON: {"status":"ok"}'}
            rows={3}
            style="width:100%; margin-top:4px; font-size:0.8rem; font-family:inherit; padding:8px; border-radius:6px; border:1px solid #d1d5db; box-sizing:border-box;"
          ></textarea>
          <button
            type="button"
            class="btn-submit"
            style="width:auto; margin-top:6px; padding:5px 12px; font-size:0.75rem;"
            onclick={() => test(p.provider_id, promptText[p.provider_id])}
            disabled={busyId === 'test:' + p.provider_id || !(promptText[p.provider_id] || '').trim()}
          >
            {busyId === 'test:' + p.provider_id ? 'Sending…' : 'Send prompt'}
          </button>
        </div>
      {/if}
    </div>
  {/each}

  {#if anyFixDefault}
    <button type="button" class="btn-submit" style="width:auto; margin-top:6px; padding:5px 12px; font-size:0.75rem; background:#e5e7eb; color:#111;" onclick={clearDefault} disabled={busyId === '__clear__'}>
      Clear AI-Fixes default (use ANTHROPIC_API_KEY secret)
    </button>
  {/if}
{/if}
