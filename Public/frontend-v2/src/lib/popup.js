// Framework-free pure logic for the v2 announcement popup.
//
// WHY THIS EXISTS
// The announcement popup (authored in the mgmt "Popup Management" screen, shown
// to popups tagged role "Public") was never ported to the v2 portal, so nothing
// appeared on load. Its behaviour is ported here VERBATIM from
// Public/frontend/script.js (~lines 641-770: loadPopup / renderPopupSlide /
// clampSlideDuration / clearAutoAdvance / scheduleAutoAdvance / popupPrev/Next).
// The DOM + timer wiring lives in the Popup.astro island; only the pure,
// side-effect-free logic lives here so it is node --check-able and unit-tested
// (see test/popup.test.mjs) without pulling in Astro, the DOM, or timers.
//
// THE XSS-SAFETY CONTRACT (do NOT weaken)
// Popup text/links are authored by an Admin in the mgmt portal but rendered on
// the PUBLIC site, so an admin account (or anyone who got hold of one) could
// otherwise inject arbitrary HTML/script and `link_url` could carry a
// `javascript:`/`data:` scheme. buildSlideHtml therefore:
//   - escapes ALL FOUR author-supplied values (image_url, text, link_url,
//     link_text) via the injected escapeHtml before interpolation, and
//   - gates image_url AND link_url through the injected safeUrl (http(s) only)
//     so a `javascript:`/`data:` URL yields NO <img>/<a> at all.
// The escapeHtml/safeUrl/drive helpers are INJECTED (deps), mirroring how
// linkify/homeRender take their helpers, so this module never imports Astro.

// Coalesce/clamp a per-slide duration. mgmt (popup_slides.duration_ms) and the
// backend already default NULL/0 to 5000ms and clamp 1000-60000ms, but we
// re-clamp here so a stale cached payload from before that logic can't stall or
// flicker the popup. null/0/NaN/<=0 -> 5000; then clamped to [1000, 60000].
export function clampSlideDuration(ms) {
  const n = parseInt(ms, 10);
  if (!isFinite(n) || n <= 0) return 5000;
  if (n < 1000) return 1000;
  if (n > 60000) return 60000;
  return n;
}

// Next slide index with wraparound (last -> 0). Guards a non-positive length by
// returning 0 so a degenerate call can never produce NaN/negative indices.
export function nextIndex(i, n) {
  if (!(n > 0)) return 0;
  return (i + 1) % n;
}

// Previous slide index with wraparound (0 -> last). Same non-positive guard.
export function prevIndex(i, n) {
  if (!(n > 0)) return 0;
  return (i - 1 + n) % n;
}

// Pick the first eligible popup from the activePopups payload. Only the FIRST
// popup is ever shown per load (if more than one is tagged "Public" and active
// at once, Superadmin should stagger start_at/end_at rather than stacking
// overlays). Returns popups[0] ONLY when it is an array whose [0] carries a
// non-empty slides array, else null (so the caller renders nothing).
export function pickFirstEligiblePopup(popups) {
  if (!Array.isArray(popups) || popups.length === 0) return null;
  const first = popups[0];
  if (!first || !Array.isArray(first.slides) || first.slides.length === 0) return null;
  return first;
}

// PURE slide -> HTML string. `deps` = { escapeHtml, safeUrl, driveImageUrl,
// driveImageFallbackUrl } is INJECTED so this module never imports Astro. The
// markup reproduces the old site's renderPopupSlide EXACTLY (Tailwind classes
// are applied by the island's static markup; the class hooks here match the old
// popup-slide-* names for parity):
//   - image ONLY when image_url && safeUrl(driveImageUrl(image_url)); the <img>
//     falls back to the Drive thumbnail (data-fb) then hides on error.
//   - text block ONLY when text is present.
//   - link ONLY when link_url && safeUrl(link_url); label defaults to
//     'Learn more'. All four values are escaped; image_url/link_url are gated.
export function buildSlideHtml(slide, deps) {
  const s = slide || {};
  const { escapeHtml, safeUrl, driveImageUrl, driveImageFallbackUrl } = deps || {};

  const parts = [];

  const imgSrc = s.image_url ? driveImageUrl(s.image_url) : '';
  if (s.image_url && safeUrl(imgSrc)) {
    parts.push(
      '<img class="popup-slide-img" src="' + escapeHtml(imgSrc) + '" alt="" ' +
      'data-fb="' + escapeHtml(driveImageFallbackUrl(s.image_url)) + '" ' +
      "onerror=\"if(this.dataset.fb&&this.dataset.fbTried!=='1'){this.dataset.fbTried='1';this.src=this.dataset.fb;}else{this.style.display='none';}\">"
    );
  }

  if (s.text) {
    parts.push('<div class="popup-slide-text">' + escapeHtml(s.text) + '</div>');
  }

  if (s.link_url && safeUrl(s.link_url)) {
    parts.push(
      '<a class="popup-slide-link" href="' + escapeHtml(s.link_url) + '" ' +
      'target="_blank" rel="noreferrer">' + escapeHtml(s.link_text || 'Learn more') + '</a>'
    );
  }

  return parts.join('');
}
