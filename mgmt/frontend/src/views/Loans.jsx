import { useState, useMemo, useEffect } from 'react';
import { api, fmt } from '../api.js';
import { useViewData } from '../useViewData.js';
import { invalidate } from '../cache.js';
import Modal from '../components/Modal.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import RowActions from '../components/RowActions.jsx';
import { canAddView } from '../permissions.js';
import { useDropdownList } from '../useDropdownList.js';
import LoanConsentModal from '../components/LoanConsentModal.jsx';
import { personOptions } from '../personOption.js';

export default function Loans({ year, users, committee, role, editable }) {
  const { data, loading, error, refresh } = useViewData(`loans:${year}`, () => api.getLoans(year), [year]);
  const { options: statusOptions, hindiOf: statusHindiOf } = useDropdownList('Loan Status');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ receiver: '', g1: '', g2: '', g3: '', Amount: '', Rate: '', Tenure: '', FinalRepaymentDate: '', Status: 'Active' });
  const [saving, setSaving] = useState(false);
  const [contributorIds, setContributorIds] = useState(null);
  const [contribLoading, setContribLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [statusLoan, setStatusLoan] = useState(null);
  const [available, setAvailable] = useState(null);

  useEffect(() => {
    if (!showAdd || editing) { setAvailable(null); return; }
    const loanYear = year === 'All' ? new Date().getFullYear() : year;
    api.getLoanBudget(loanYear).then(r => setAvailable(r && typeof r.available === 'number' ? r.available : null)).catch(() => setAvailable(null));
  }, [showAdd, editing, year]);

  const userMap = useMemo(() => {
    const m = {};
    (users || []).forEach(u => { m[u.ID] = u; });
    return m;
  }, [users]);

  const committeeIds = useMemo(() => new Set((committee || []).map(c => c.Name)), [committee]);

  useEffect(() => {
    setContribLoading(true);
    api.getYearContributors(year).then(ids => setContributorIds(new Set(ids))).finally(() => setContribLoading(false));
  }, [year]);

  const contributorOptions = useMemo(() => {
    if (!contributorIds) return [];
    // C15: father's name in the label — a loan's receiver and its guarantors must be the
    // right people, and two same-name contributors are otherwise indistinguishable here too.
    return personOptions((users || []).filter(u => contributorIds.has(u.ID)));
  }, [users, contributorIds]);

  const closeModal = () => {
    setShowAdd(false);
    setEditing(null);
    setForm({ receiver: '', g1: '', g2: '', g3: '', Amount: '', Rate: '', Tenure: '', FinalRepaymentDate: '', Status: 'Active' });
  };

  const openEdit = (loan) => {
    setEditing(loan);
    setForm({ receiver: loan.Name, g1: '', g2: '', g3: '', Amount: loan.Amount, Rate: loan['Intrest Rate'] || loan['Interest Rate'] || '', Tenure: loan.Tenure || '', FinalRepaymentDate: loan['Final Repayment Date'] || '', Status: loan.Status || 'Active' });
    setShowAdd(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (editing) {
      if (!form.Amount) return alert('Amount is required');
      setSaving(true);
      try {
        // `Created By` is not sent: the server owns it and REJECTS it. `Final Repayment
        // Date` IS sent and must be — the operator types it, the create path has always
        // written it and the consent document reads it back; #323 wrongly listed it as
        // server-owned, which is now corrected.
        await api.updateRecord('LOANS', editing.__rowIndex, { Year: editing.Year, Name: editing.Name, Amount: form.Amount, 'Intrest Rate': form.Rate, Tenure: form.Tenure, 'Final Repayment Date': form.FinalRepaymentDate, Status: form.Status });
        invalidate('loans:');
        closeModal();
        refresh();
      } catch (err) {
        alert(err.message);
      } finally {
        setSaving(false);
      }
      return;
    }

    const { receiver, g1, g2, g3, Amount, Rate, Tenure, FinalRepaymentDate } = form;
    if (!receiver || !g1 || !g2 || !g3) return alert('Select Receiver and all 3 Guarantors');
    if (new Set([receiver, g1, g2, g3]).size !== 4) return alert('Receiver and Guarantors must all be different');
    if ([g1, g2, g3].some(g => committeeIds.has(g))) return alert('Rule Violation: A Committee Member cannot be a Guarantor');
    if (!Amount) return alert('Amount is required');
    if (!FinalRepaymentDate) return alert('Final Repayment Date is required');
    if (available !== null && (parseFloat(Amount) || 0) > available + 0.01) {
      return alert(`This loan (₹${parseFloat(Amount) || 0}) exceeds what is still available to lend this year: ₹${Math.max(0, Math.round(available * 100) / 100)}.`);
    }
    setSaving(true);
    try {
      const loanYear = year === 'All' ? new Date().getFullYear() : year;
      await api.saveLoan(
        { Year: loanYear, Name: receiver, Amount, 'Intrest Rate': Rate, Tenure, 'Final Repayment Date': FinalRepaymentDate, Status: 'Active' },
        [g1, g2, g3].map(g => ({ Year: loanYear, Loaner: receiver, Guarantor: g }))
      );
      invalidate('loans:');
      closeModal();
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeLoan = async (loan) => {
    if (!confirm('Delete this loan and all its guarantors? This action cannot be undone.')) return;
    try {
      await api.deleteLoan(loan.__rowIndex, loan.Year, loan.Name, loan['Loan ID']);
      invalidate('loans:');
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="inline-spinner">Loading loans...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  const loans = data?.loans || [];
  const guarantors = data?.guarantors || [];

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>Surplus Loan Distribution</h2>

      {loans.length === 0 && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>Not Distributed Yet</div>}

      {loans.map((loan, idx) => {
        const uReceiver = userMap[loan.Name] || { Name: loan.Name ? `${loan.Name} (not in Users)` : 'Unknown' };
        const guars = loan['Loan ID']
          ? guarantors.filter(g => (g['Loan ID'] || '').toString().trim() === loan['Loan ID'].toString().trim())
          : guarantors.filter(g => parseInt(g.Year) === parseInt(loan.Year) && g.Loaner === loan.Name);
        return (
          <div className="glass-card" style={{ background: '#FFFBEB', borderColor: '#FCD34D' }} key={(loan['Loan ID'] || '').toString().trim() || loan.__rowIndex || idx}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <h3 style={{ color: '#92400E' }}>Surplus Loan {year === 'All' ? `(${loan.Year})` : ''}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className={`badge ${loan.Status === 'Repaid' ? 'badge-ok' : 'badge-warn'}`}>{loan.Status || 'Active'}{statusHindiOf(loan.Status || 'Active') ? ` (${statusHindiOf(loan.Status || 'Active')})` : ''}</span>
                {loan['Loan ID'] && (
                  <span
                    className={`badge ${loan['Loan Status'] === 'Disbursed' ? 'badge-ok' : loan['Loan Status'] === 'Approved' ? 'badge-pending' : 'badge-warn'}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setStatusLoan(loan)}
                  >
                    {loan['Loan Status'] || 'Created'} 🔗
                  </span>
                )}
                <RowActions role={role} disabled={!editable} onEdit={() => openEdit(loan)} onDelete={() => removeLoan(loan)} />
              </div>
            </div>
            <div style={{ background: 'white', padding: 15, borderRadius: 8, border: '1px solid #FDE68A', marginBottom: 15 }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Receiver</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 'bold', marginBottom: 10 }}>{uReceiver.Name}</div>
              <div className="grid-3">
                <div><span style={{ fontSize: '0.75rem' }}>Amount</span><br /><strong>{fmt(loan.Amount)}</strong></div>
                <div><span style={{ fontSize: '0.75rem' }}>Int. Rate</span><br /><strong>{loan['Intrest Rate'] || loan['Interest Rate'] || '0'}%</strong></div>
                <div><span style={{ fontSize: '0.75rem' }}>Tenure</span><br /><strong>{loan.Tenure || '0'} Mo</strong></div>
              </div>
            </div>
            <h4 style={{ marginBottom: 10, color: '#92400E' }}>Guarantors</h4>
            {guars.length === 0 && <p>No guarantors on record.</p>}
            {guars.map((g, gi) => {
              const uG = userMap[g.Guarantor] || { Name: g.Guarantor ? `${g.Guarantor} (not in Users)` : 'Unknown' };
              return (
                <div className="glass-card" style={{ padding: 15, marginBottom: 10 }} key={gi}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{uG.Name}</strong>
                    <span className="badge badge-ok">Village: {uG.Village || '-'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {editable && canAddView(role, 'loans') && (
        <button className="fab" onClick={() => setShowAdd(true)}><span className="material-icons-round">add</span></button>
      )}

      <Modal open={showAdd} onClose={closeModal}>
        <h3 style={{ marginBottom: 5 }}>{editing ? 'Edit Loan Terms' : 'Issue Loan'}</h3>
        {!editing && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 15 }}>
            Receiver and Guarantors can only be selected from {year === 'All' ? new Date().getFullYear() : year}'s contributors.
          </p>
        )}
        {editing && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 15 }}>
            Receiver: <strong>{userMap[editing.Name]?.Name || editing.Name}</strong> (the receiver/guarantors cannot be changed here — only the terms can be edited)
          </p>
        )}
        {contribLoading && !editing && <div className="inline-spinner">Loading contributors...</div>}
        {(editing || !contribLoading) && (
          <form onSubmit={submit}>
            {!editing && (
              <div className="form-group">
                <label>Receiver</label>
                <SearchableSelect options={contributorOptions} value={form.receiver} onChange={v => setForm({ ...form, receiver: v })} />
              </div>
            )}
            <div className="form-group">
              <label>Amount</label>
              <input type="number" value={form.Amount} onChange={e => setForm({ ...form, Amount: e.target.value })} />
              {!editing && available !== null && (
                <div style={{ fontSize: '0.78rem', marginTop: 4, color: ((parseFloat(form.Amount) || 0) > available + 0.01) ? 'var(--danger)' : 'var(--text-muted)' }}>
                  Available to lend this year: ₹{Math.max(0, Math.round(available * 100) / 100)}
                  {(parseFloat(form.Amount) || 0) > available + 0.01 ? ' — this loan exceeds it' : ''}
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Interest Rate (%)</label>
              <input type="number" step="0.1" value={form.Rate} onChange={e => setForm({ ...form, Rate: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Tenure (Months)</label>
              <input type="number" value={form.Tenure} onChange={e => setForm({ ...form, Tenure: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Final Repayment Date</label>
              <input type="date" value={form.FinalRepaymentDate} onChange={e => setForm({ ...form, FinalRepaymentDate: e.target.value })} />
            </div>
            {editing && (
              <div className="form-group">
                <label>Status</label>
                <select value={form.Status} onChange={e => setForm({ ...form, Status: e.target.value })}>
                  {statusOptions.map(s => (
                    <option key={s['English Value']} value={s['English Value']}>
                      {s['English Value']}{s['Hindi Label'] ? ` (${s['Hindi Label']})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!editing && ['g1', 'g2', 'g3'].map((key, i) => (
              <div className="form-group" key={key}>
                <label>Guarantor {i + 1}</label>
                <SearchableSelect options={contributorOptions} value={form[key]} onChange={v => setForm({ ...form, [key]: v })} />
              </div>
            ))}
            <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : (editing ? 'Save Changes' : 'Issue Loan')}</button>
          </form>
        )}
      </Modal>

      <LoanConsentModal
        loan={statusLoan || {}}
        open={!!statusLoan}
        onClose={() => setStatusLoan(null)}
        role={role}
        contributorOptions={contributorOptions}
        onChanged={refresh}
      />
    </>
  );
}
