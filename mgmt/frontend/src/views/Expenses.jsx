import { useState } from 'react';
import { api, fmt } from '../api.js';
import { useViewData } from '../useViewData.js';
import { invalidate } from '../cache.js';
import { useDropdownList } from '../useDropdownList.js';
import Modal from '../components/Modal.jsx';
import RowActions from '../components/RowActions.jsx';
import TransliterateInput from '../components/TransliterateInput.jsx';
import { canAddView } from '../permissions.js';

const BLANK = { Discription: '', 'Discription (Hindi)': '', Amount: '', Category: 'Other' };

export default function Expenses({ year, role, editable }) {
  const { data, loading, error, refresh } = useViewData(`expenses:${year}`, () => api.getExpenses(year), [year]);
  const { options: categoryOptions, hindiOf: categoryHindiOf } = useDropdownList('Category');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  const closeModal = () => {
    setShowAdd(false);
    setEditing(null);
    setForm(BLANK);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({ Discription: r.Discription, 'Discription (Hindi)': r['Discription (Hindi)'] || '', Amount: r.Amount, Category: r.Category || 'Other' });
    setShowAdd(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.Discription || !form.Amount) return alert('Fill all fields');
    setSaving(true);
    try {
      if (editing) {
        await api.updateRecord('EXPENSES', editing.__rowIndex, { Year: editing.Year, Discription: form.Discription, 'Discription (Hindi)': form['Discription (Hindi)'], Amount: form.Amount, Category: form.Category, 'Created By': editing['Created By'] });
      } else {
        await api.saveRecord('EXPENSES', { Year: year === 'All' ? new Date().getFullYear() : year, ...form });
      }
      invalidate('expenses:');
      invalidate('home:');
      closeModal();
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!confirm('Delete this expense entry?')) return;
    try {
      await api.deleteRecord('EXPENSES', r.__rowIndex);
      invalidate('expenses:');
      invalidate('home:');
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="inline-spinner">Loading expenses...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Expenses Ledger</h2>
      <div className="glass-card">
        {(!data || data.length === 0) && <div style={{ textAlign: 'center', padding: 20 }}>No expenses recorded.</div>}
        {(data || []).map((r, i) => (
          <div className="data-row" key={r.__rowIndex ?? i}>
            <div>
              <strong style={{ display: 'block' }}>{r.Discription} {year === 'All' && <span style={{ color: 'var(--primary-saffron)', fontSize: '0.75rem' }}>[{r.Year}]</span>}</strong>
              {r.Category && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.Category}{categoryHindiOf(r.Category) ? ` (${categoryHindiOf(r.Category)})` : ''}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <strong style={{ color: 'var(--danger)' }}>-{fmt(r.Amount)}</strong>
              <RowActions role={role} disabled={!editable} onEdit={() => openEdit(r)} onDelete={() => remove(r)} />
            </div>
          </div>
        ))}
      </div>

      {editable && canAddView(role, 'expenses') && (
        <button className="fab" onClick={() => setShowAdd(true)}><span className="material-icons-round">add</span></button>
      )}

      <Modal open={showAdd} onClose={closeModal}>
        <h3 style={{ marginBottom: 15 }}>{editing ? 'Edit Expense' : 'Add Expense'}</h3>
        <form onSubmit={submit}>
          <TransliterateInput
            label="Description"
            value={{ en: form.Discription, hi: form['Discription (Hindi)'] }}
            onChange={({ en, hi }) => setForm({ ...form, Discription: en, 'Discription (Hindi)': hi })}
          />
          <div className="form-group">
            <label>Amount</label>
            <input type="number" value={form.Amount} onChange={e => setForm({ ...form, Amount: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Category</label>
            <select value={form.Category} onChange={e => setForm({ ...form, Category: e.target.value })}>
              {categoryOptions.map(c => (
                <option key={c['English Value']} value={c['English Value']}>
                  {c['English Value']}{c['Hindi Label'] ? ` (${c['Hindi Label']})` : ''}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </form>
      </Modal>
    </>
  );
}
