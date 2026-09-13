<script lang="ts">
  // Ported from React views/ConsentPage.jsx (public /consent/:token route) —
  // shows the consent document, OTP-verifies via WhatsApp, then Accept (photo +
  // geo + signature) or Decline (reason). Locked once a decision is recorded.
  import { page } from '$app/stores';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { api } from '$lib/api';
  import { generateQrDataUrl, publicRecordUrl } from '$lib/qrCode'; // eslint-disable-line no-unused-vars
  import ReportErrorButton from '$lib/components/ReportErrorButton.svelte';
  import CameraCapture from '$lib/components/consent/CameraCapture.svelte';
  import ConsentPdfDownload from '$lib/components/consent/ConsentPdfDownload.svelte';

  const MAX_SIGNATURE_BYTES = 1024 * 1024;
  const pageStyle = 'min-height:100vh; background:var(--bg-offwhite); padding:20px 15px;';

  let token = $derived($page.params.token ?? '');

  function substitutePlaceholders(text: string, placeholders: Record<string, unknown>): string {
    return (text || '').replace(/\[([A-Z0-9_]+)\]/g, (m, key) =>
      Object.prototype.hasOwnProperty.call(placeholders || {}, key) ? String(placeholders[key]) : m
    );
  }

  function fileToCompressedBase64(file: File, maxDim = 1000, quality = 0.7): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('File could not be read'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Image failed to load'));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  function getGeoLocation(): Promise<any> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ ok: false, reason: 'unsupported' });
      let done = false;
      const finish = (v: any) => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 27000);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); finish({ ok: true, coords: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } }); },
        (err) => {
          clearTimeout(timer);
          const reason = err && err.code === 1 ? 'denied' : (err && err.code === 3 ? 'timeout' : 'unavailable');
          finish({ ok: false, reason });
        },
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
      );
    });
  }

  let data = $state<any>(null);
  let loading = $state(true);
  let error = $state('');
  let otpSent = $state(false);
  let otp = $state('');
  let verifyToken = $state('');
  let agreed = $state(false);
  let busy = $state(false);
  let finalStatus = $state<string | null>(null);
  let mode = $state<string | null>(null);

  let photo = $state<string | null>(null);
  let geo = $state<any>(null);
  let geoState = $state('idle');
  let geoReason = $state('');
  let signatureBase64 = $state<string | null>(null);
  let signatureError = $state('');
  let declineRemarks = $state('');

  function verifyStoreKey() { return `consent_vt_${token}`; }
  function setVerified(vt: string) {
    verifyToken = vt || '';
    try {
      if (vt) sessionStorage.setItem(verifyStoreKey(), vt);
      else sessionStorage.removeItem(verifyStoreKey());
    } catch (e) { /* ignore */ }
  }

  function load() {
    loading = true;
    api.getConsentByToken(token)
      .then((d: any) => {
        data = d;
        if (d.status !== 'pending') finalStatus = d.status;
        else if (verifyToken) otpSent = true;
      })
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  }

  // React: useEffect on [token] — restore any stored verify token, then load.
  let lastToken = '';
  $effect(() => {
    const t = token;
    if (t === lastToken) return;
    lastToken = t;
    try { verifyToken = sessionStorage.getItem(`consent_vt_${t}`) || ''; } catch (e) { verifyToken = ''; }
    load();
  });

  async function sendOtp() {
    busy = true;
    error = '';
    try {
      await api.requestConsentOtp(token);
      otpSent = true;
      otp = '';
      setVerified('');
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function verifyOtp() {
    if (!otp.trim()) return;
    busy = true;
    error = '';
    try {
      const res: any = await api.verifyConsentOtp(token, otp.trim());
      setVerified((res && res.verifyToken) || '');
      load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function requestGeo() {
    geoState = 'requesting';
    const result = await getGeoLocation();
    if (result && result.ok) { geo = result.coords; geoState = 'granted'; }
    else { geoReason = (result && result.reason) || 'unavailable'; geoState = 'failed'; }
  }

  async function onSignatureFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    signatureError = '';
    signatureBase64 = null;
    if (!file) return;
    if (file.size > MAX_SIGNATURE_BYTES) {
      signatureError = 'File is larger than 1MB — please upload a smaller photo/scan.';
      return;
    }
    try {
      signatureBase64 = await fileToCompressedBase64(file, 800, 0.8);
    } catch (err) {
      signatureError = (err as Error).message;
    }
  }

  async function submitAccept() {
    if (!confirm('You are about to Accept — confirm?')) return;
    busy = true;
    error = '';
    try {
      const res: any = await api.respondConsent(token, 'accepted', { geo, photoBase64: photo, signatureBase64, verifyToken });
      finalStatus = res.status;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function submitDecline() {
    if (!declineRemarks.trim()) { alert('Please provide a reason for declining'); return; }
    if (!confirm('You are about to Decline — confirm?')) return;
    busy = true;
    error = '';
    try {
      const res: any = await api.respondConsent(token, 'declined', { declineRemarks: declineRemarks.trim(), verifyToken });
      finalStatus = res.status;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  let locked = $derived(finalStatus || (data && data.status !== 'pending' ? data.status : null));
  let html = $derived(data ? DOMPurify.sanitize(marked.parse(substitutePlaceholders(data.templateText, data.placeholders)) as string) : '');
  let acceptReady = $derived(photo && geo && signatureBase64);
</script>

{#if loading}
  <div style={pageStyle}><div class="inline-spinner">Loading...</div></div>
{:else if error && !data}
  <div style={pageStyle}>
    <div class="glass-card" style="padding:20px; max-width:480px; margin:40px auto;">
      <div class="error-banner">{error}</div>
      <ReportErrorButton page="Consent" message={error} />
    </div>
  </div>
{:else if data}
  <div style={pageStyle}>
    <div class="glass-card" style="padding:20px; max-width:640px; margin:20px auto;">
      <div class="consent-doc">{@html html}</div>

      {#if error}<div class="error-banner" style="margin:15px 0;">{error}</div>{/if}

      {#if locked}
        <div style="text-align:center; padding:20px;">
          <span class="badge {locked === 'accepted' ? 'badge-ok' : 'badge-warn'}" style="font-size:1rem; padding:8px 16px;">
            {locked === 'accepted' ? '✓ You have Accepted / आपने स्वीकार किया' : '✕ You have Declined / आपने अस्वीकार किया'}
          </span>
          <p style="margin-top:12px; font-size:0.8rem; color:var(--text-muted);">This decision is final and cannot be changed.</p>
          <ConsentPdfDownload
            role={data.role}
            fundYear={data.placeholders.FUND_YEAR}
            placeholders={data.placeholders}
            consentId={data.consentId}
            docTypeFromServer={data.docType}
            {token}
          />
        </div>
      {:else}
        <label style="display:flex; gap:8px; align-items:flex-start; margin:15px 0; font-size:0.85rem; cursor:pointer;">
          <input type="checkbox" bind:checked={agreed} style="margin-top:3px;" />
          <span>मैंने ऊपर दिए गए सभी विवरण और नियम-शर्तों को ध्यानपूर्वक पढ़ लिया है और समझ लिया है। / I have read and understood all the details and terms mentioned above.</span>
        </label>

        {#if data.lockedReason}
          <div style="background:#FEF3C7; color:#92400E; padding:10px; border-radius:8px; font-size:0.8rem; margin-bottom:12px;">
            ⚠️ Final Acceptance Locked — {data.lockedReason}. You cannot Accept until all three guarantors have Accepted (you may still Decline).
          </div>
        {/if}

        {#if !otpSent}
          <button class="btn-submit" onclick={sendOtp} disabled={busy || !agreed}>
            {busy ? 'Sending...' : 'Send OTP via WhatsApp'}
          </button>
        {:else if !verifyToken}
          <div class="form-group">
            <label>Enter OTP (sent via WhatsApp)</label>
            <input value={otp} oninput={(e) => (otp = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))} maxlength={6} inputmode="numeric" />
          </div>
          <button class="btn-submit" onclick={verifyOtp} disabled={busy || otp.length !== 6}>
            {busy ? 'Verifying...' : 'Verify OTP'}
          </button>
          <button type="button" class="btn-submit" style="background:#e5e7eb; color:#111; margin-top:8px;" onclick={sendOtp} disabled={busy}>
            Resend OTP
          </button>
        {:else if !mode}
          <div style="display:flex; gap:10px;">
            <button class="btn-submit" style="background:var(--success);" onclick={() => (mode = 'accept')} disabled={!!data.lockedReason}>
              Accept / स्वीकार करें
            </button>
            <button class="btn-submit" style="background:var(--danger);" onclick={() => (mode = 'decline')}>
              Decline / अस्वीकार करें
            </button>
          </div>
        {:else if mode === 'decline'}
          <div>
            <div class="form-group">
              <label>Reason for declining (required)</label>
              <textarea rows={3} bind:value={declineRemarks} style="width:100%; padding:8px; border-radius:8px; border:1px solid #ddd;"></textarea>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn-submit" style="background:var(--danger);" onclick={submitDecline} disabled={busy || !declineRemarks.trim()}>
                {busy ? 'Submitting...' : 'Confirm Decline'}
              </button>
              <button type="button" class="btn-submit" style="background:#e5e7eb; color:#111;" onclick={() => (mode = null)}>Back</button>
            </div>
          </div>
        {:else}
          <div>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
              All three are required to Accept — photo, location, and signature. These will be permanently saved with your consent record.
            </p>

            <div style="margin-bottom:15px;">
              <strong style="font-size:0.85rem; display:block; margin-bottom:6px;">1. Take Your Photo</strong>
              <CameraCapture {photo} onCapture={(p) => (photo = p)} />
            </div>

            <div style="margin-bottom:15px;">
              <strong style="font-size:0.85rem; display:block; margin-bottom:6px;">2. Location</strong>
              {#if geoState === 'granted'}
                <span class="badge badge-ok">✓ Location Captured</span>
              {:else}
                <button type="button" class="btn-submit" onclick={requestGeo} disabled={geoState === 'requesting'}>
                  {geoState === 'requesting' ? 'Getting location…' : (geoState === 'failed' ? '🔄 Try Location Again' : '📍 Allow Location')}
                </button>
              {/if}
              {#if geoState === 'failed'}
                <p style="color:var(--danger); font-size:0.8rem; margin-top:6px;">
                  {geoReason === 'denied'
                    ? 'Location permission was blocked. Allow location for this site in your browser settings, then tap "Try Location Again".'
                    : geoReason === 'unsupported'
                      ? 'This browser cannot share location. Please open the link in Chrome or Safari and try again.'
                      : geoReason === 'timeout'
                        ? "Could not get a location fix in time. Make sure your phone's GPS/Location is ON, move near a window or outdoors, then tap \"Try Location Again\"."
                        : "Could not determine your location. Turn ON your phone's Location (GPS), then tap \"Try Location Again\"."}
                </p>
              {/if}
            </div>

            <div style="margin-bottom:15px;">
              <strong style="font-size:0.85rem; display:block; margin-bottom:6px;">3. Upload Your Signature (max 1MB)</strong>
              <div style="background:#f9fafb; border-radius:8px; padding:10px; margin-bottom:8px; font-size:0.75rem; color:var(--text-muted);">
                Sign on a plain sheet of paper, take a clear photo of it, and upload it here.
              </div>
              <input type="file" accept="image/*" onchange={onSignatureFile} />
              {#if signatureBase64}
                <img src={`data:image/jpeg;base64,${signatureBase64}`} alt="Signature" style="max-width:100%; max-height:120px; margin-top:8px; border:1px solid #eee; border-radius:6px;" />
              {/if}
              {#if signatureError}<p style="color:var(--danger); font-size:0.8rem; margin-top:6px;">{signatureError}</p>{/if}
            </div>

            <div style="display:flex; gap:8px;">
              <button class="btn-submit" style="background:var(--success);" onclick={submitAccept} disabled={busy || !acceptReady}>
                {busy ? 'Submitting...' : 'Confirm Accept'}
              </button>
              <button type="button" class="btn-submit" style="background:#e5e7eb; color:#111;" onclick={() => (mode = null)}>Back</button>
            </div>
          </div>
        {/if}

        <p style="font-size:0.7rem; color:var(--text-muted); margin-top:12px;">
          To Accept, your photo, signature, device, IP, and location will be recorded as required.
        </p>
      {/if}
    </div>
  </div>
{/if}
