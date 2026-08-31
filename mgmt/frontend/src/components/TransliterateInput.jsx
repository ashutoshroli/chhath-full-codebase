import { useState, useEffect, useRef } from 'react';
import { transliterate } from '../transliterate.js';

// value = { en, hi }, onChange({ en, hi })
// Auto-fills `hi` from `en` as the user types (debounced), unless the user has
// manually edited the Hindi field themselves (edit pencil) — a manual edit
// "locks" hi so further English typing doesn't overwrite their correction,
// until English is cleared and retyped from empty.
export default function TransliterateInput({ label, value, onChange, placeholder, listId }) {
  const en = value?.en || '';
  const hi = value?.hi || '';
  const [manualHi, setManualHi] = useState(false);
  const [hiEditable, setHiEditable] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (manualHi) return;
    if (!en) { onChange({ en, hi: '' }); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const result = await transliterate(en);
      onChange({ en, hi: result });
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [en]);

  return (
    <div className="form-group">
      <label>{label}</label>
      <input
        value={en}
        placeholder={placeholder}
        list={listId}
        onChange={e => {
          const v = e.target.value;
          if (!v) setManualHi(false);
          onChange({ en: v, hi });
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <input
          value={hi}
          placeholder={`${label} (Hindi)`}
          readOnly={!hiEditable}
          style={{ background: hiEditable ? '#fff' : '#f9fafb', flexGrow: 1 }}
          onChange={e => { setManualHi(true); onChange({ en, hi: e.target.value }); }}
        />
        <span
          className="material-icons-round"
          style={{ cursor: 'pointer', fontSize: '1.1rem', color: hiEditable ? 'var(--primary-saffron)' : 'var(--text-muted)' }}
          title="Edit Hindi text"
          onClick={() => setHiEditable(v => !v)}
        >
          edit
        </span>
      </div>
    </div>
  );
}
