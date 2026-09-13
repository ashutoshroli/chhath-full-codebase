<script lang="ts">
  // "Journey Content" — manages the public "Our Journey / 10 Years of Chhath"
  // story: the bilingual tagline (portal_settings journey_tagline_en/_hi) and the
  // per-year entries (journey_entries). Parity with the React JourneyContent.jsx.
  import { api } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';

  interface Entry {
    id: number; year: number | string; title_en: string; title_hi: string;
    content_en: string; content_hi: string; position: number;
  }
  const BLANK = { id: null as number | null, year: '', title_en: '', title_hi: '', content_en: '', content_hi: '' };

  // Static page-text fields, grouped for the editor (parity with React).
  interface TextField { key: string; label: string; area?: boolean; }
  const PAGE_TEXT_GROUPS: { title: string; fields: TextField[] }[] = [
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

  let entries = $state<Entry[]>([]);
  let loading = $state(true);
  let error = $state('');
  let form = $state<any>({ ...BLANK });
  let editingOpen = $state(false);
  let saving = $state(false);

  let taglineEn = $state('');
  let taglineHi = $state('');
  let taglineSaving = $state(false);
  let taglineMsg = $state('');

  // Page text (two JSON blobs).
  let textEn = $state<Record<string, string>>({});
  let textHi = $state<Record<string, string>>({});
  let textLang = $state<'en' | 'hi'>('en');
  let textSaving = $state(false);
  let textMsg = $state('');

  const parseJson = (v: unknown): Record<string, string> => {
    try { return v ? JSON.parse(v as string) : {}; } catch { return {}; }
  };
  function textVal(key: string): string {
    return (textLang === 'hi' ? textHi : textEn)[key] || '';
  }
  function setTextVal(key: string, val: string) {
    if (textLang === 'hi') textHi = { ...textHi, [key]: val };
    else textEn = { ...textEn, [key]: val };
  }

  async function refresh() {
    loading = true;
    try {
      const rows = await api.getJourneyEntries();
      entries = Array.isArray(rows) ? (rows as Entry[]) : [];
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    refresh();
    Promise.all([api.getPortalSetting('journey_tagline_en'), api.getPortalSetting('journey_tagline_hi')])
      .then(([en, hi]: any) => { taglineEn = (en && en.value) || ''; taglineHi = (hi && hi.value) || ''; })
      .catch(() => {});
    Promise.all([api.getPortalSetting('journey_page_text_en'), api.getPortalSetting('journey_page_text_hi')])
      .then(([en, hi]: any) => { textEn = parseJson(en && en.value); textHi = parseJson(hi && hi.value); })
      .catch(() => {});
  });

  function startNew() {
    const nextYear = entries.length ? Math.max(...entries.map((e) => Number(e.year) || 0)) + 1 : new Date().getFullYear();
    form = { ...BLANK, year: String(nextYear) };
    editingOpen = true;
  }

  function startEdit(e: Entry) {
    form = {
      id: e.id, year: String(e.year || ''),
      title_en: e.title_en || '', title_hi: e.title_hi || '',
      content_en: e.content_en || '', content_hi: e.content_hi || '',
    };
    editingOpen = true;
  }

  function closeForm() { editingOpen = false; form = { ...BLANK }; }

  async function save(ev: Event) {
    ev.preventDefault();
    if (!String(form.year).trim()) { alert('Year is required'); return; }
    if (!form.title_en.trim() && !form.title_hi.trim()) { alert('A title (English or Hindi) is required'); return; }
    saving = true;
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
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function remove(e: Entry) {
    if (!confirm(`Delete the ${e.year} entry? This cannot be undone.`)) return;
    try {
      await api.deleteJourneyEntry(e.id);
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function move(index: number, dir: number) {
    const target = index + dir;
    if (target < 0 || target >= entries.length) return;
    const next = entries.slice();
    [next[index], next[target]] = [next[target], next[index]];
    entries = next; // optimistic
    try {
      await api.reorderJourneyEntries(next.map((e) => e.id));
    } catch (err) {
      alert((err as Error).message);
      refresh();
    }
  }

  async function saveTagline(ev: Event) {
    ev.preventDefault();
    taglineSaving = true;
    taglineMsg = '';
    try {
      await api.setPortalSetting('journey_tagline_en', taglineEn);
      await api.setPortalSetting('journey_tagline_hi', taglineHi);
      taglineMsg = 'Saved.';
    } catch (err) {
      alert((err as Error).message);
    } finally {
      taglineSaving = false;
    }
  }

  async function savePageText(ev: Event) {
    ev.preventDefault();
    textSaving = true;
    textMsg = '';
    try {
      await api.setPortalSetting('journey_page_text_en', JSON.stringify(textEn));
      await api.setPortalSetting('journey_page_text_hi', JSON.stringify(textHi));
      textMsg = 'Saved.';
    } catch (err) {
      alert((err as Error).message);
    } finally {
      textSaving = false;
    }
  }
</script>

<h2 style="margin-bottom:15px;">Journey Content</h2>

<!-- Tagline editor -->
<div class="glass-card" style="margin-bottom:20px;">
  <h3 style="margin-bottom:10px;">Tagline</h3>
  <form onsubmit={saveTagline}>
    <div class="form-group">
      <label>Tagline (English)</label>
      <input bind:value={taglineEn} placeholder="A decade of faith, unity and service" />
    </div>
    <div class="form-group">
      <label>Tagline (Hindi)</label>
      <input bind:value={taglineHi} placeholder="आस्था, एकता और सेवा का एक दशक" />
    </div>
    <button class="btn-submit" disabled={taglineSaving}>{taglineSaving ? 'Saving...' : 'Save Tagline'}</button>
    {#if taglineMsg}<span style="margin-left:10px; color:var(--success); font-size:0.85rem;">{taglineMsg}</span>{/if}
  </form>
</div>

<!-- Page text editor -->
<div class="glass-card" style="margin-bottom:20px;">
  <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:10px; flex-wrap:wrap;">
    <h3 style="margin:0;">Page Text</h3>
    <div style="display:inline-flex; gap:4px;">
      <button type="button" class={textLang === 'en' ? 'btn-submit' : 'btn-secondary'} style="padding:4px 12px;" onclick={() => (textLang = 'en')}>English</button>
      <button type="button" class={textLang === 'hi' ? 'btn-submit' : 'btn-secondary'} style="padding:4px 12px;" onclick={() => (textLang = 'hi')}>हिंदी</button>
    </div>
  </div>
  <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0;">
    Editing <strong>{textLang === 'hi' ? 'Hindi' : 'English'}</strong>. Leave a field blank to fall back to the built-in text. Keep any {'{placeholders}'} (e.g. {'{start}'}, {'{amount}'}, {'{year}'}).
  </p>
  <form onsubmit={savePageText}>
    {#each PAGE_TEXT_GROUPS as g (g.title)}
      <details style="margin-bottom:10px; border:1px solid var(--border, #e5e7eb); border-radius:8px; padding:8px 12px;">
        <summary style="cursor:pointer; font-weight:700; font-size:0.9rem;">{g.title}</summary>
        <div style="margin-top:8px;">
          {#each g.fields as f (f.key)}
            <div class="form-group">
              <label>{f.label}</label>
              {#if f.area}
                <textarea rows={3} value={textVal(f.key)} oninput={(e) => setTextVal(f.key, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
              {:else}
                <input value={textVal(f.key)} oninput={(e) => setTextVal(f.key, (e.currentTarget as HTMLInputElement).value)} />
              {/if}
            </div>
          {/each}
        </div>
      </details>
    {/each}
    <button class="btn-submit" disabled={textSaving}>{textSaving ? 'Saving...' : 'Save Page Text'}</button>
    {#if textMsg}<span style="margin-left:10px; color:var(--success); font-size:0.85rem;">{textMsg}</span>{/if}
  </form>
</div>

<!-- Entries -->
<h3 style="margin-bottom:10px;">Year Entries</h3>
{#if loading}
  <div class="inline-spinner">Loading journey entries...</div>
{:else if error}
  <div class="error-banner">{error}</div>
{:else}
  <div class="glass-card">
    {#if entries.length === 0}
      <div style="text-align:center; padding:20px;">No entries yet.</div>
    {/if}
    {#each entries as e, i (e.id)}
      <div class="data-row">
        <div>
          <strong style="display:block;">{e.title_en || e.title_hi || e.year}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">{e.year} · pos {e.position}</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="icon-btn" title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>
            <span class="material-icons-round">arrow_upward</span>
          </button>
          <button class="icon-btn" title="Move down" disabled={i === entries.length - 1} onclick={() => move(i, 1)}>
            <span class="material-icons-round">arrow_downward</span>
          </button>
          <button class="icon-btn" title="Edit" onclick={() => startEdit(e)}>
            <span class="material-icons-round">edit</span>
          </button>
          <button class="icon-btn icon-danger" title="Delete" onclick={() => remove(e)}>
            <span class="material-icons-round">delete</span>
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<button class="fab" onclick={startNew}><span class="material-icons-round">add</span></button>

<Modal open={editingOpen} onClose={closeForm}>
  <h3 style="margin-bottom:15px;">{form.id ? 'Edit Entry' : 'Add Entry'}</h3>
  <form onsubmit={save}>
    <div class="form-group">
      <label>Year</label>
      <input value={form.year} inputmode="numeric" maxlength={4}
        oninput={(e) => (form = { ...form, year: (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4) })} />
    </div>
    <div class="form-group">
      <label>Title (English)</label>
      <input value={form.title_en} oninput={(e) => (form = { ...form, title_en: (e.currentTarget as HTMLInputElement).value })} placeholder="2017 — A New Beginning" />
    </div>
    <div class="form-group">
      <label>Title (Hindi)</label>
      <input value={form.title_hi} oninput={(e) => (form = { ...form, title_hi: (e.currentTarget as HTMLInputElement).value })} placeholder="2017 — एक नई शुरुआत" />
    </div>
    <div class="form-group">
      <label>Content (English)</label>
      <textarea rows={4} value={form.content_en} oninput={(e) => (form = { ...form, content_en: (e.currentTarget as HTMLTextAreaElement).value })}></textarea>
    </div>
    <div class="form-group">
      <label>Content (Hindi)</label>
      <textarea rows={4} value={form.content_hi} oninput={(e) => (form = { ...form, content_hi: (e.currentTarget as HTMLTextAreaElement).value })}></textarea>
    </div>
    <div style="display:flex; gap:10px;">
      <button type="button" class="btn-secondary" onclick={closeForm}>Cancel</button>
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </div>
  </form>
</Modal>
