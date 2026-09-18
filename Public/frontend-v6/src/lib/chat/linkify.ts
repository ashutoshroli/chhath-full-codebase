/**
 * Chat linkifier — turns an UNTRUSTED bot reply string (data.answer from the
 * Render chat endpoint) into an ordered list of structured tokens so the chat
 * bubble can render clickable links WITHOUT ever using {@html}.
 *
 * WHY tokens instead of an HTML string: the reply is external, untrusted text.
 * By returning `{ type: 'text' }` / `{ type: 'link' }` tokens, the .svelte
 * template renders text via `{token.value}` (Svelte auto-escapes) and links via
 * a real `<a href={token.href}>` element (Svelte escapes the attribute value).
 * There is no code path that inserts raw markup, so HTML/attribute-breakout
 * injection is structurally impossible — no DOMPurify / markdown dependency
 * needed (v6 has none, and the CI JS budget is tight).
 *
 * Recognised, in precedence order:
 *   1. markdown links      [label](url)
 *   2. markdown autolinks  <url>          (angle brackets stripped)
 *   3. bare urls           http(s)://...
 * Everything else stays plain text. Only http:// and https:// URLs ever become
 * links; javascript:, data:, vbscript:, file:, mailto:, relative and
 * protocol-relative targets are emitted as text (shown literally, never as an
 * anchor).
 */

export type LinkToken = { type: 'link'; href: string; label: string };
export type TextToken = { type: 'text'; value: string };
export type Token = LinkToken | TextToken;

/** Only http/https targets are allowed to become anchors. */
function safeHref(url: string): string | null {
  const raw = url.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return raw;
    return null;
  } catch {
    return null;
  }
}

// Trailing punctuation that is almost always sentence punctuation rather than
// part of a bare URL, so it should not be swallowed into the href.
const TRAILING_PUNCT = new Set(['.', ',', ')', ']', '}', '!', '?', ';', ':', '"', "'", '>', '<']);

/** Split a bare-URL match into the real URL and any trailing punctuation. */
function trimTrailingPunct(url: string): { url: string; trailing: string } {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCT.has(url[end - 1])) {
    // Keep a closing paren when it balances an opening paren inside the URL
    // (common in Wikipedia-style links), otherwise strip it.
    const ch = url[end - 1];
    if (ch === ')') {
      const opens = (url.slice(0, end).match(/\(/g) || []).length;
      const closes = (url.slice(0, end).match(/\)/g) || []).length;
      if (opens >= closes) break;
    }
    end--;
  }
  return { url: url.slice(0, end), trailing: url.slice(end) };
}

// A single combined scanner. Order of alternatives sets precedence:
//   markdown link | markdown autolink | bare url
const TOKEN_RE =
  /\[([^\]\n]*?)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\))?[^\s()]*)\)|<(https?:\/\/[^\s<>]+)>|(https?:\/\/[^\s<>]+)/gi;

/**
 * Turn a bot reply into an ordered list of text/link tokens. Whitespace,
 * newlines and leading indentation are preserved exactly inside text tokens so
 * the existing `whitespace-pre-wrap` layout stays intact.
 */
export function linkifyTokens(text: string): Token[] {
  const src = text ?? '';
  const tokens: Token[] = [];
  let last = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === 'text') prev.value += value;
    else tokens.push({ type: 'text', value });
  };

  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    const [full, mdLabel, mdUrl, autoUrl, bareUrl] = m;
    const start = m.index;
    pushText(src.slice(last, start));

    if (mdUrl !== undefined) {
      // [label](url)
      const href = safeHref(mdUrl);
      if (href) tokens.push({ type: 'link', href, label: mdLabel ?? href });
      else pushText(full);
    } else if (autoUrl !== undefined) {
      // <url> — strip the surrounding angle brackets
      const href = safeHref(autoUrl);
      if (href) tokens.push({ type: 'link', href, label: href });
      else pushText(full);
    } else if (bareUrl !== undefined) {
      // bare http(s) url — keep trailing sentence punctuation out of the href
      const { url, trailing } = trimTrailingPunct(bareUrl);
      const href = safeHref(url);
      if (href) {
        tokens.push({ type: 'link', href, label: href });
        pushText(trailing);
      } else {
        pushText(full);
      }
    } else {
      pushText(full);
    }

    last = start + full.length;
    if (TOKEN_RE.lastIndex === start) TOKEN_RE.lastIndex++; // guard against zero-width
  }

  pushText(src.slice(last));

  // Guarantee at least one token so callers can always iterate.
  if (tokens.length === 0) tokens.push({ type: 'text', value: '' });
  return tokens;
}
