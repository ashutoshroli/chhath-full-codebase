<script lang="ts">
  // Parity with the React views/DonationSettings.jsx — manage the public
  // "Donate Now" page fields (UPI id, QR image on R2, bank details, WhatsApp
  // number). Values live in portal_settings (donation_*); the QR bytes go to R2
  // and only the URL is stored. The committee-member list on the public page is
  // the live committee (Committee tab) — not entered here.
  import { api, reportClientError } from '$lib/api';
  import { prepareImageForUpload } from '$lib/imagePrep';
  import { checkDonationDetails } from '$lib/money';

  const str = (v: unknown) => (v === undefined || v === null ? '' : v.toString());

  // portal_settings key -> local form field.
  const FIELDS: Record<string, string> = {
    donation_upi_id: 'upiId',
    donation_qr_url: 'qrUrl',
    donation_bank_account_name: 'bankAccountName',
    donation_bank_name: 'bankName',
    donation_account_number: 'accountNumber',
    donation_ifsc: 'ifsc',
    donation_whatsapp: 'whatsapp'
  };

  const EMPTY = {
    upiId: '',
    qrUrl: '',
    bankAccountName: '',
    bankName: '',
    accountNumber: '',
    ifsc: '',
    whatsapp: ''
  };

  let form = $state<Record<string, string>>({ ...EMPTY });
  let loading = $state(true);
  let saving = $state(false);
  let uploading = $state(false);
  let error = $state('');
  let notice = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const keys = Object.keys(FIELDS);
      const values = await Promise.all(keys.map((k) => api.getPortalSetting(k)));
      const next: Record<string, string> = { ...EMPTY };
      keys.forEach((k, i) => {
        const res: any = values[i];
        next[FIELDS[k]] = str(res && typeof res === 'object' ? res.value : res);
      });
      form = next;
    } catch (err) {
      error = (err as Error).message || 'Failed to load donation settings.';
      reportClientError('DonationSettings', 'Failed to load donation settings', err as Error);
    } finally {
      loading = false;
    }
  }
  let started = false;
  $effect(() => { if (started) return; started = true; load(); });

  function set(patch: Record<string, string>) { form = { ...form, ...patch }; }

  async function uploadQr(file: File | undefined) {
    if (!file) return;
    uploading = true;
    error = '';
    notice = '';
    try {
      const prepped = await prepareImageForUpload(file);
      const res: any = await api.uploadDonationQr(prepped.base64, prepped.fileName);
      const url = res.url || res.imageUrl;
      if (!url) throw new Error('The server did not return an image URL.');
      set({ qrUrl: url });
      notice = 'QR uploaded. Remember to press Save to publish it.';
    } catch (err) {
      error = `QR upload failed: ${(err as Error).message}`;
      reportClientError('DonationSettings', 'Donation QR upload failed', err as Error, { fileName: file.name, fileType: file.type, fileSize: file.size });
    } finally {
      uploading = false;
    }
  }

  async function save() {
    // audit: these seven values were published one setting at a time, and NOTHING
    // was validated first. So a typo'd UPI id or account number went live on the
    // public Donate page, and a failure halfway through left the page showing a
    // MIX of old and new payment details — the worst possible state for a page
    // whose whole purpose is telling people where to send money.
    //
    // Both halves are now closed. This check keeps the error next to the field the
    // operator is looking at; the SERVER repeats it (settings.js), which is what
    // actually guarantees it, since this view is not the only caller. And the write
    // is a SINGLE atomic action — carry-over C3, the "single atomic settings action
    // on the backend" this comment used to ask for — so there is no longer a
    // half-published state to report.
    const problem = checkDonationDetails({
      upiId: form.upiId,
      accountNumber: form.accountNumber,
      ifsc: form.ifsc,
      whatsapp: form.whatsapp
    });
    if (problem) {
      error = problem;
      notice = '';
      return;
    }

    saving = true;
    error = '';
    notice = '';
    try {
      const settings: Record<string, string> = {};
      for (const [key, field] of Object.entries(FIELDS)) {
        settings[key] = str(form[field]).trim();
      }
      await api.setPortalSettings(settings);
      notice = 'Donation settings saved. The public Donate Now page updates within a minute.';
      await load();
    } catch (err) {
      const message = (err as Error).message || 'Failed to save donation settings.';
      // No "N of 7 already published" any more: the write is all-or-none, so a failure
      // means the live Donate page is exactly as it was.
      error = `${message} — nothing was changed, the Donate page still shows the previous details.`;
      reportClientError('DonationSettings', 'Failed to save donation settings', err as Error);
      await load();
    } finally {
      saving = false;
    }
  }

  const inputStyle = 'width:100%; padding:10px; border-radius:8px; border:1px solid #ddd; font-size:0.9rem; margin-bottom:12px;';
  const labelStyle = 'font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:5px;';
  const btn = (bg: string) => `background:${bg}; color:#fff; border:none; padding:10px 16px; border-radius:8px; font-weight:700; font-size:0.9rem; cursor:pointer;`;
</script>

{#if loading}
  <div class="inline-spinner">Loading...</div>
{:else}
  <div>
    <h2 style="margin-bottom:6px;">Donation</h2>
    <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:16px;">
      Manage the details shown on the public <strong>Donate Now</strong> page — UPI ID and
      QR, bank transfer details, and the WhatsApp number for payment proof. Any field left
      blank is simply hidden on the public page. The committee-member list on that page is
      the live committee (managed under the Committee tab) — you do not enter names here.
    </p>

    {#if error}<div class="glass-card" style="border-color:var(--danger); color:var(--danger); margin-bottom:12px; padding:12px;">{error}</div>{/if}
    {#if notice}<div class="glass-card" style="border-color:var(--success); color:var(--success); margin-bottom:12px; padding:12px;">{notice}</div>{/if}

    <div class="glass-card" style="margin-bottom:18px; padding:16px;">
      <h3 style="margin-bottom:12px;">Online (UPI)</h3>

      <label style={labelStyle}>UPI ID</label>
      <input style={inputStyle} value={form.upiId} oninput={(e) => set({ upiId: (e.currentTarget as HTMLInputElement).value })} placeholder="example@okbank" />

      <label style={labelStyle}>UPI QR image</label>
      <input type="file" accept="image/*" onchange={(e) => uploadQr((e.currentTarget as HTMLInputElement).files?.[0])} disabled={uploading} style="margin-bottom:12px;" />
      {#if uploading}<div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">Uploading...</div>{/if}
      {#if form.qrUrl}
        <div style="margin-bottom:12px;">
          <div style={labelStyle}>Current QR</div>
          <img src={form.qrUrl} alt="UPI QR" style="width:160px; height:160px; object-fit:contain; border:1px solid #eee; border-radius:8px; background:#fff;" />
          <div>
            <button type="button" onclick={() => set({ qrUrl: '' })} style="margin-top:8px; background:transparent; color:var(--danger); border:1px solid var(--danger); padding:6px 12px; border-radius:8px; font-size:0.8rem; cursor:pointer;">Remove QR</button>
          </div>
        </div>
      {/if}
    </div>

    <div class="glass-card" style="margin-bottom:18px; padding:16px;">
      <h3 style="margin-bottom:12px;">Bank Transfer</h3>

      <label style={labelStyle}>Account Name</label>
      <input style={inputStyle} value={form.bankAccountName} oninput={(e) => set({ bankAccountName: (e.currentTarget as HTMLInputElement).value })} placeholder="Navyuvak Chhath Puja Samiti" />

      <label style={labelStyle}>Bank</label>
      <input style={inputStyle} value={form.bankName} oninput={(e) => set({ bankName: (e.currentTarget as HTMLInputElement).value })} placeholder="State Bank of India" />

      <label style={labelStyle}>A/C No.</label>
      <input style={inputStyle} value={form.accountNumber} oninput={(e) => set({ accountNumber: (e.currentTarget as HTMLInputElement).value })} placeholder="00000000000" />

      <label style={labelStyle}>IFSC</label>
      <input style={inputStyle} value={form.ifsc} oninput={(e) => set({ ifsc: (e.currentTarget as HTMLInputElement).value })} placeholder="SBIN0000000" />
    </div>

    <div class="glass-card" style="margin-bottom:18px; padding:16px;">
      <h3 style="margin-bottom:12px;">Payment Proof</h3>
      <label style={labelStyle}>WhatsApp number (for sending payment screenshot / UTR)</label>
      <input style={inputStyle} value={form.whatsapp} oninput={(e) => set({ whatsapp: (e.currentTarget as HTMLInputElement).value })} placeholder="+91 90000 00000" />
    </div>

    <div style="display:flex; gap:10px; align-items:center;">
      <button style={btn('var(--primary-saffron, #F97316)')} onclick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
{/if}
