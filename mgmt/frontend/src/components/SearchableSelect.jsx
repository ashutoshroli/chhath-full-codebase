import { useEffect, useRef, useState } from 'react';

// options: [{ value, label, sub }]  sub = optional secondary line (e.g. village)
export default function SearchableSelect({ options, value, onChange, placeholder = 'Search...', onAddNew }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const onClickOutside = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase()) || (o.sub || '').toLowerCase().includes(query.toLowerCase())
  ).slice(0, 50);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder={placeholder}
          value={open ? query : (selected ? selected.label : '')}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={e => setQuery(e.target.value)}
        />
        {onAddNew && (
          <button type="button" className="btn-outline" style={{ flexShrink: 0, width: 44 }} onClick={onAddNew} title="Add new">
            <span className="material-icons-round" style={{ fontSize: 18, verticalAlign: 'middle' }}>add</span>
          </button>
        )}
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: onAddNew ? 52 : 0, background: 'white',
          border: '1px solid #ddd', borderRadius: 8, maxHeight: 220, overflowY: 'auto', zIndex: 10, boxShadow: 'var(--shadow)'
        }}>
          {filtered.length === 0 && <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: '0.9rem' }}>No matches</div>}
          {filtered.map(o => (
            <div
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
              style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}
              onMouseDown={e => e.preventDefault()}
            >
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{o.label}</div>
              {o.sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
