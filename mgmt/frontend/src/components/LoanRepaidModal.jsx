import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { todayIST } from '../istTime.js';
import { loanTotalDue } from '../loanDue.js';

// "Mark as Repaid" — same shape as the disbursement form in LoanConsentModal: a Cash
// and an Online amount that together must equal EXACTLY what is owed (loan + interest).
// No partial repayment. The server recomputes the amount due and re-checks everything.
export default function LoanRepaidModal({ loan, open, onClose, onDone }) {
  const [cash, setCash] = useState('');
  const [online, setOnline] = useState('');
  const [date, setDate] = useState(todayIST());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setCash(''); setOnline(''); setDate(todayIST()); }
  }, [open, loan && loan['Loan ID']]);

  const due = loanTotalDue(loan?.Amount, loan?.['Intrest Rate'] || loan?.['Interest Rate'], loan?.Tenure);
  const total = Math.round(((parseFloat(cash) || 0) + (parseFloat(online) || 0)) * 100) / 100;
  const matches = Math.abs(total - due.total) <= 0.01;
  const today = todayIST();

  const submit = async () => {
    const c = parseFloat(cash) || 0;
    const o = parseFloat(online) || 0;
    if (c < 0 || o < 0) return alert('Cash and Online amounts cannot be negative.');
    if (!matches) return alert(`Cash + Online (₹${total}) must equal the full amount due ₹${due.total}. Partial repayment is not allowed.`);
    if (!date) return alert('Please enter the repayment date.');
    if (!confirm(`Mark as Repaid: Cash ₹${c} + Online ₹${o} = Total ₹${total} on ${date}. Confirm?`)) return;
    setBusy(true);
    try {
      const res = await api.markLoanRepaid(loan['Loan ID'], c, o, date);
      if (res && res.messageWarning) alert(res.messageWarning);
      onDone && onDone();
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h3 style={{ marginBottom: 8 }}>Mark as Repaid</h3>
      <p style={{ fontSize: '0.85rem', marginTop: 0, marginBottom: 12 }}>
        Loan <strong>₹{due.principal}</strong> + Interest <strong>₹{due.interest}</strong> = Total due <strong>₹{due.total}</strong>
        <br />
        <span style={{ color: 'var(--text-muted)' }}>Cash + Online must add up to exactly this. Partial repayment is not allowed.</span>
      </p>
      <div className="form-group">
        <label>Repayment Date</label>
        <input type="date" className="input-field" value={date} max={today} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Cash Amount (₹)</label>
        <input type="number" min="0" className="input-field" value={cash} onChange={e => setCash(e.target.value)} placeholder="0" />
      </div>
      <div className="form-group">
        <label>Online Amount (₹)</label>
        <input type="number" min="0" className="input-field" value={online} onChange={e => setOnline(e.target.value)} placeholder="0" />
      </div>
      <p style={{ fontSize: '0.85rem', marginTop: 6, color: matches ? 'var(--text-main)' : 'var(--danger)' }}>
        Total: ₹{total}{matches ? ' ✓' : ` — must equal ₹${due.total}`}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn-submit" style={{ width: 'auto' }} onClick={submit} disabled={busy || !matches || !date}>
          {busy ? 'Saving...' : 'Confirm Repaid'}
        </button>
        <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
