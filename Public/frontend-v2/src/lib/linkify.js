// XSS-safe "clickable links" for the chatbot's bot replies — framework-free.
//
// WHY THIS EXISTS
// The chatbot answer is UNTRUSTED model output coming back from the Render
// /public-chat endpoint. We still want Markdown links `[label](url)` and bare
// http(s):// URLs in that answer to render as clickable <a> tags. Doing that
// safely is subtle enough that the logic lives here, in ONE audited, pure module
// that both the browser island (Chatbot.astro) and the Node test harness import.
// Ported VERBATIM from Public/frontend/script.js (app.linkifyBotText) so both
// portals share identical, reviewed behaviour.
//
// ORDERING IS THE SECURITY PROPERTY: escape-FIRST-then-linkify.
//   (1) escapeHtml() the WHOLE reply first, so every < > & " ' the model produced
//       is neutralised. After this step the string contains NO live markup at all.
//   (2) Only THEN run the linkify regex over the already-escaped string. Because
//       escapeHtml does not touch [ ] ( ), a Markdown link is still matchable, and
//       an http(s):// URL has no raw < > so it survives intact.
//   (3) Every candidate URL is passed through safeUrl(): if it is not http(s)
//       (javascript:, data:, vbscript:, …) safeUrl returns '' and we DO NOT build
//       a link — the text stays as its already-escaped, inert form.
// The consequence: the ONLY HTML that can ever appear in the output is the <a>
// tags THIS function emits, and their href is constrained to http(s) by safeUrl.
// Nothing the model returns can create any other element or attribute. This is
// why appendChatMsg may safely assign the result to innerHTML for the bot bubble.
//
// DEPENDENCY INJECTION: escapeHtml + safeUrl are passed in as arguments so this
// function is pure and can be evaluated by the Node test harness without a DOM.
// Callers pass the shared implementations from src/lib/dom-escape.js.
export function linkifyBotText(text, escapeHtmlFn, safeUrlFn) {
  const escaped = escapeHtmlFn(text);
  // The regex below runs over the ALREADY-escaped string, so a URL captured from
  // it carries HTML entities (e.g. a query-string '&' is '&amp;', a '"' is
  // '&quot;'). We must reverse that ONE level of escaping before validating the
  // scheme and placing the value in the href, otherwise escapeHtml runs a second
  // time on '&amp;' and the live href gets '&amp;amp;' — which breaks
  // parameterised links (?a=1&b=2). So: unescape the matched URL back to its raw
  // form, gate it with safeUrl (http(s) only — dangerous schemes still yield no
  // link), then escapeHtml the SAFE raw URL exactly once for the href attribute.
  // The visible label stays the already-escaped text (never the raw value), so
  // no unescaped model output can reach the DOM.
  const unescapeHtml = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&'); // &amp; last so it does not re-introduce entities
  // Markdown-link branch FIRST (so a URL inside a Markdown link is not also caught
  // by the bare-URL branch), then the bare-URL branch. Left-to-right replace.
  // The bare-URL branch is case-insensitive to align with safeUrl (so an uppercase
  // HTTPS:// bare URL is linkified too).
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+)/gi;
  return escaped.replace(re, (match, mdLabel, mdUrl, bareUrl) => {
    if (bareUrl !== undefined) {
      // Trim common trailing punctuation so 'see https://x/y.pdf.' keeps the URL
      // clean and the period stays as sentence text after the link.
      let url = bareUrl;
      let trailing = '';
      const trailingRe = /[.,;:)\]}'"]+$/;
      const tm = url.match(trailingRe);
      if (tm) { trailing = tm[0]; url = url.slice(0, url.length - trailing.length); }
      // Recover the raw URL (undo the one level of HTML-escaping) for safeUrl/href.
      const safe = safeUrlFn(unescapeHtml(url));
      if (!safe) return match; // not http(s) — leave the escaped text as-is
      return '<a href="' + escapeHtmlFn(safe) + '" target="_blank" rel="noopener noreferrer nofollow">' + url + '</a>' + trailing;
    }
    // Markdown branch. mdUrl/mdLabel are already HTML-escaped (escape ran first).
    // Recover the raw URL for safeUrl/href so a query-string '&' is not double-escaped.
    const safe = safeUrlFn(unescapeHtml(mdUrl));
    if (!safe) return match; // dangerous scheme — leave the escaped [label](url) text
    return '<a href="' + escapeHtmlFn(safe) + '" target="_blank" rel="noopener noreferrer nofollow">' + mdLabel + '</a>';
  });
}
