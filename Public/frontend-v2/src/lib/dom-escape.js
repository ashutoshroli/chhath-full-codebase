// Shared HTML-escaping + URL-gating helpers for the v2 public portal.
//
// WHY THIS EXISTS
// The Home island and (Phase 4) the chatbot both build DOM with innerHTML
// string templates. Any value that originates from an authenticated author
// (contributor names, popup slide text, link URL/label) MUST be escaped before
// interpolation, otherwise the management portal becomes an injection vector
// into the public site. Ported VERBATIM from Public/frontend/script.js so both
// portals share exactly the same, audited behaviour.

// escapeHtml is correct for BOTH text content AND quoted-attribute contexts, and
// deliberately so: it escapes the double AND single quote, so an interpolated
// value cannot terminate either form of quoted attribute. There is intentionally
// no separate `escapeAttr` alias — a name implying attribute-specific escaping
// that did not exist only invited someone to "improve" one and not the other.
export function escapeHtml(v) {
  return (v === undefined || v === null ? '' : v.toString())
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only http(s) — blocks javascript:, data:, vbscript: in href/src. Trims first,
// then returns the URL only when it starts with an http(s) scheme, else '' so a
// dangerous or relative URL can never reach an <a href>/<img src>.
export function safeUrl(v) {
  const raw = (v === undefined || v === null ? '' : v.toString()).trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}
