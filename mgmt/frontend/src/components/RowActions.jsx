import { useState, useRef, useEffect } from 'react';
import { canEdit, canDelete } from '../permissions.js';

// A compact 3-dot (⋮) menu for row actions. Replaces the old always-visible
// edit/delete icon pair — this takes almost no horizontal space (fixing the
// cramped/overlapping card layouts) and reveals Edit/Delete on tap.
// `disabled` renders nothing regardless of role (All-Years view, locked years).
export default function RowActions({ role, onEdit, onDelete, disabled }) {
  const showEdit = !disabled && canEdit(role) && onEdit;
  const showDelete = !disabled && canDelete(role) && onDelete;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on any outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!showEdit && !showDelete) return null;

  const pick = (fn) => (e) => { e.stopPropagation(); setOpen(false); fn(); };

  return (
    <div className="row-actions-menu" ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="icon-btn"
        title="Actions"
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      >
        <span className="material-icons-round" style={{ fontSize: 18 }}>more_vert</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 30,
            background: '#fff', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
            border: '1px solid #eee', minWidth: 130, overflow: 'hidden',
          }}
        >
          {showEdit && (
            <button type="button" role="menuitem" onClick={pick(onEdit)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#111' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span> Edit
            </button>
          )}
          {showDelete && (
            <button type="button" role="menuitem" onClick={pick(onDelete)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--danger, #dc2626)', borderTop: showEdit ? '1px solid #f1f1f1' : 'none' }}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
