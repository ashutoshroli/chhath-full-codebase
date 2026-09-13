import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';
import { prepareImageForUpload } from '../imagePrep.js';

const str = (v) => (v === undefined || v === null ? '' : v.toString());

// The portal_settings keys this tab manages, mapped to the local form field.
const FIELDS = {
  donation_upi_id: 'upiId',
  donation_qr_url: 'qrUrl',
  donation_bank_account_name: 'bankAccountName',
  donation_bank_name: 'bankName',
  donation_account_number: 'accountNumber',
  donation_ifsc: 'ifsc',
  donation_whatsapp: 'whatsapp',
};

const EMPTY = {
  upiId: '',
  qrUrl: '',
  bankAccountName: '',
  bankName: '',
  accountNumber: '',
  ifsc: '',
  whatsapp: '',
};

export default function DonationSettings() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const keys = Object.keys(FIELDS);
      const values = await Promise.all(keys.map((k) => api.getPortalSetting(k)));
      const next = { ...EMPTY };
      keys.forEach((k, i) => {
        const res = values[i];
        // getPortalSetting may return a string or { value }.
        next[FIELDS[k]] = str(res && typeof res === 'object' ? res.value : res);
      });
      setForm(next);
    } catch (err) {
      setError(err.message || 'Failed to load donation settings.');
      reportClientError('DonationSettings', 'Failed to load donation settings', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const uploadQr = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const prepped = await prepareImageForUpload(file);
      const res = await api.uploadDonationQr(prepped.base64, prepped.fileName);
      const url = res.url || res.imageUrl;
      if (!url) throw new Error('The server did not return an image URL.');
      set({ qrUrl: url });
      setNotice('QR uploaded. Remember to press Save to publish it.');
    } catch (err) {
      setError(`QR upload failed: ${err.message}`);
      reportClientError('DonationSettings', 'Donation QR upload failed', err, {
        fileName: file.name, fileType: file.type, fileSize: file.size,
      });
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      // Persist each field to its portal_settings key.
      for (const [key, field] of Object.entries(FIELDS)) {
        await api.setPortalSetting(key, str(form[field]).trim());
      }
      setNotice('Donation settings saved. The public Donate Now page updates within a minute.');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to save donation settings.');
      reportClientError('DonationSettings', 'Failed to save donation settings', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="inline-spinner">Loading...</div>;

  const inputStyle = { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: '0.9rem', marginBottom: 12 };
  const labelStyle = { fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 5 };
  const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' });

  return (
    <div>
      <h2 style={{ marginBottom: 6 }}>Donation</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 16 }}>
        Manage the details shown on the public <strong>Donate Now</strong> page — UPI ID and
        QR, bank transfer details, and the WhatsApp number for payment proof. Any field left
        blank is simply hidden on the public page. The committee-member list on that page is
        the live committee (managed under the Committee tab) — you do not enter names here.
      </p>

      {error && <div className="glass-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 12, padding: 12 }}>{error}</div>}
      {notice && <div className="glass-card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 12, padding: 12 }}>{notice}</div>}

      {}
      <div className="glass-card" style={{ marginBottom: 18, padding: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Online (UPI)</h3>

        <label style={labelStyle}>UPI ID</label>
        <input style={inputStyle} value={form.upiId} onChange={(e) => set({ upiId: e.target.value })} placeholder="example@okbank" />

        <label style={labelStyle}>UPI QR image</label>
        <input type="file" accept="image/*" onChange={(e) => uploadQr(e.target.files[0])} disabled={uploading} style={{ marginBottom: 12 }} />
        {uploading && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>Uploading...</div>}
        {form.qrUrl && (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Current QR</div>
            <img src={form.qrUrl} alt="UPI QR" style={{ width: 160, height: 160, objectFit: 'contain', border: '1px solid #eee', borderRadius: 8, background: '#fff' }} />
            <div>
              <button
                type="button"
                onClick={() => set({ qrUrl: '' })}
                style={{ marginTop: 8, background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', padding: '6px 12px', borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Remove QR
              </button>
            </div>
          </div>
        )}
      </div>

      {}
      <div className="glass-card" style={{ marginBottom: 18, padding: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Bank Transfer</h3>

        <label style={labelStyle}>Account Name</label>
        <input style={inputStyle} value={form.bankAccountName} onChange={(e) => set({ bankAccountName: e.target.value })} placeholder="Navyuvak Chhath Puja Samiti" />

        <label style={labelStyle}>Bank</label>
        <input style={inputStyle} value={form.bankName} onChange={(e) => set({ bankName: e.target.value })} placeholder="State Bank of India" />

        <label style={labelStyle}>A/C No.</label>
        <input style={inputStyle} value={form.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} placeholder="00000000000" />

        <label style={labelStyle}>IFSC</label>
        <input style={inputStyle} value={form.ifsc} onChange={(e) => set({ ifsc: e.target.value })} placeholder="SBIN0000000" />
      </div>

      {}
      <div className="glass-card" style={{ marginBottom: 18, padding: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Payment Proof</h3>
        <label style={labelStyle}>WhatsApp number (for sending payment screenshot / UTR)</label>
        <input style={inputStyle} value={form.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="+91 90000 00000" />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={btn('var(--primary-saffron, #F97316)')} onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
