
export function clampSlideDuration(ms) {
  const n = parseInt(ms, 10);
  if (!isFinite(n) || n <= 0) return 5000;
  if (n < 1000) return 1000;
  if (n > 60000) return 60000;
  return n;
}

export function nextIndex(i, n) {
  if (!(n > 0)) return 0;
  return (i + 1) % n;
}

export function prevIndex(i, n) {
  if (!(n > 0)) return 0;
  return (i - 1 + n) % n;
}

export function pickFirstEligiblePopup(popups) {
  if (!Array.isArray(popups) || popups.length === 0) return null;
  const first = popups[0];
  if (!first || !Array.isArray(first.slides) || first.slides.length === 0) return null;
  return first;
}

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
