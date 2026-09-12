export function linkifyBotText(text, escapeHtmlFn, safeUrlFn) {
  const escaped = escapeHtmlFn(text);
  const unescapeHtml = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+)/gi;
  return escaped.replace(re, (match, mdLabel, mdUrl, bareUrl) => {
    if (bareUrl !== undefined) {
      let url = bareUrl;
      let trailing = '';
      const trailingRe = /[.,;:)\]}'"]+$/;
      const tm = url.match(trailingRe);
      if (tm) { trailing = tm[0]; url = url.slice(0, url.length - trailing.length); }
      const safe = safeUrlFn(unescapeHtml(url));
      if (!safe) return match;
      return '<a href="' + escapeHtmlFn(safe) + '" target="_blank" rel="noopener noreferrer nofollow">' + url + '</a>' + trailing;
    }
    const safe = safeUrlFn(unescapeHtml(mdUrl));
    if (!safe) return match;
    return '<a href="' + escapeHtmlFn(safe) + '" target="_blank" rel="noopener noreferrer nofollow">' + mdLabel + '</a>';
  });
}
