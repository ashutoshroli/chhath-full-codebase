import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useDropdownList, invalidateDropdownLists } from '../useDropdownList.js';
import TransliterateInput from '../components/TransliterateInput.jsx';
import FestivalDates from '../components/FestivalDates.jsx';

const TYPES = ['Category', 'Payment Mode', 'Loan Status', 'Village'];

export default function ListManagement() {
  const [years, setYears] = useState(null);
  const [yearsError, setYearsError] = useState('');
  useEffect(() => { api.getYears().then(setYears).catch(err => setYearsError(err.message)); }, []);
  const [activeType, setActiveType] = useState('Category');
  const { options, loading, refresh } = useDropdownList(activeType);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({ en: '', hi: '' });
  const [saving, setSaving] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [editValue, setEditValue] = useState({ en: '', hi: '' });

  const switchType = (t) => {
    setActiveType(t);
    setAdding(false);
    setEditingRow(null);
  };

  const doRefresh = () => { invalidateDropdownLists(); refresh(); };

  const addItem = async (e) => {
    e.preventDefault();
    if (!newItem.en.trim()) return alert('English value is required');
    setSaving(true);
    try {
      await api.addDropdownListItem(activeType, newItem.en, newItem.hi);
      setNewItem({ en: '', hi: '' });
      setAdding(false);
      doRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row) => {
    setEditingRow(row.__rowIndex);
    setEditValue({ en: row['English Value'], hi: row['Hindi Label'] || '' });
  };

  const saveEdit = async (row) => {
    setSaving(true);
    try {
      await api.updateDropdownListItem(row.__rowIndex, editValue.en, editValue.hi, true);
      setEditingRow(null);
      doRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (row) => {
    if (!confirm(`Delete "${row['English Value']}" from the list? Existing records will not be affected, but this value will no longer appear in the dropdown for new entries.`)) return;
    try {
      await api.deleteDropdownListItem(row.__rowIndex);
      doRefresh();
    } catch (err) {
      alert(err.message);
    }
  };


  return (
    <>
      <h2 style={{ marginBottom: 15 }}>List Management</h2>

      {yearsError && <div className="error-banner">Years failed to load: {yearsError}</div>}
      <FestivalDates years={years} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 15, flexWrap: 'wrap' }}>
        {TYPES.map(t => (
          <button
            key={t}
            className={`nav-btn ${activeType === t ? 'active' : ''}`}
            onClick={() => switchType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <div className="inline-spinner">Loading...</div>}

      {!loading && (
        <div className="glass-card">
          {options.length === 0 && <div style={{ textAlign: 'center', padding: 20 }}>No values found.</div>}
          {options.map(row => (
            <div className="data-row" key={row.__rowIndex}>
              {editingRow === row.__rowIndex ? (
                <div style={{ flexGrow: 1 }}>
                  <TransliterateInput
                    label="English Value"
                    value={editValue}
                    onChange={setEditValue}
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--danger)', margin: '4px 0' }}>
                    Note: Changing the English value will not update the label on previously saved records — the new value will be treated as a brand-new item.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-submit" style={{ width: 'auto' }} onClick={() => saveEdit(row)} disabled={saving}>Save</button>
                    <button className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={() => setEditingRow(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <strong style={{ display: 'block' }}>{row['English Value']}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{row['Hindi Label'] || '-'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="material-icons-round" style={{ cursor: 'pointer' }} onClick={() => startEdit(row)}>edit</span>
                    <span className="material-icons-round" style={{ cursor: 'pointer', color: 'var(--danger)' }} onClick={() => removeItem(row)}>delete</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!adding && (
        <button className="fab" onClick={() => setAdding(true)}><span className="material-icons-round">add</span></button>
      )}

      {adding && (
        <div className="glass-card" style={{ padding: 15, marginTop: 15 }}>
          <h3 style={{ marginBottom: 10 }}>Add to {activeType}</h3>
          <form onSubmit={addItem}>
            <TransliterateInput label="English Value" value={newItem} onChange={setNewItem} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Add'}</button>
              <button type="button" className="btn-submit" style={{ background: '#e5e7eb', color: '#111' }} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
