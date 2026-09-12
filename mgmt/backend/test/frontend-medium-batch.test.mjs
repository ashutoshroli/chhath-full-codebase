// ======== AUDIT M-24, M-29, M-30, M-31, P-10, L-17..L-19, L-21 ========
//
// The frontend batch. The runner lives in mgmt/backend because that is the only
// place with one (same as the P-8 polling tests); every file imported here is plain
// ESM with no React or DOM dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTruthyFlag as feFlag, } from '../../frontend/src/flags.js';
import { isTruthyFlag as beFlag } from '../src/flags.js';
import { getCached, setCached, invalidate, _cacheSize } from '../../frontend/src/cache.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ============================ M-31: THE TWO isTruthyFlag COPIES DISAGREED

// The frontend copy was:
//     v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'
// which does NOT trim and does NOT accept 'yes'. The backend does both. So for a
// value like ' 1 ' or 'True ' — which the original Google Sheet migration really
// did write — the backend served the row as ON while the admin list rendered the
// badge as OFF. No error, nothing logged: the two halves of the app simply
// disagreed about the same byte.
const EVERY_FORM = [
  // (value, expected)
  [true, true], [1, true], ['1', true], ['true', true], ['True', true], ['TRUE', true],
  ['yes', true], ['Yes', true], ['YES', true],
  [' 1 ', true], ['  true  ', true], ['True ', true], ['\t1\n', true],
  [false, false], [0, false], ['0', false], ['false', false], ['False', false],
  ['', false], ['   ', false], [null, false], [undefined, false],
  ['no', false], ['nope', false], ['2', false], ['on', false],
];

// The OLD frontend implementation, verbatim, so the divergence is demonstrated
// rather than described. (The file cannot be imported at its old revision, because
// this suite also imports `_cacheSize` from cache.js, which did not exist then.)
const oldFrontendFlag = (v) =>
  v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

test('M-31 proof: the OLD frontend parser disagreed with the backend on real data', () => {
  const disagreements = [];
  for (const [value] of EVERY_FORM) {
    if (oldFrontendFlag(value) !== beFlag(value)) {
      disagreements.push(`${JSON.stringify(value)}: frontend ${oldFrontendFlag(value)} vs backend ${beFlag(value)}`);
    }
  }
  // This is the bug, measured. Every one of these forms is present in live columns:
  // the sheet migration wrote values with stray whitespace, and 'yes' is accepted by
  // the backend. The backend served the row as ON while the UI rendered it as OFF.
  assert.deepEqual(disagreements, [
    '"yes": frontend false vs backend true',
    '"Yes": frontend false vs backend true',
    '"YES": frontend false vs backend true',
    '" 1 ": frontend false vs backend true',
    '"  true  ": frontend false vs backend true',
    '"True ": frontend false vs backend true',
    '"\\t1\\n": frontend false vs backend true',
  ]);
  assert.equal(disagreements.length, 7, 'seven forms disagreed');
});

test('M-31: the frontend and backend flag parsers agree on every form', () => {
  const disagreements = [];
  for (const [value] of EVERY_FORM) {
    const fe = feFlag(value);
    const be = beFlag(value);
    if (fe !== be) disagreements.push(`${JSON.stringify(value)}: frontend ${fe} vs backend ${be}`);
  }
  assert.deepEqual(disagreements, [],
    'the two copies must be behaviourally identical:\n' + disagreements.join('\n'));
});

test('M-31: and both give the documented answer, not merely the same answer', () => {
  // Agreeing on a WRONG answer would satisfy the test above.
  for (const [value, expected] of EVERY_FORM) {
    assert.equal(beFlag(value), expected, `backend: ${JSON.stringify(value)}`);
    assert.equal(feFlag(value), expected, `frontend: ${JSON.stringify(value)}`);
  }
});

test('M-31: the exact values the sheet migration wrote are ON, in both', () => {
  // These are the ones that used to diverge, called out individually so a
  // regression names the real-world case rather than "one of 24 forms".
  for (const v of [' 1 ', 'True ', 'yes', '  true  ']) {
    assert.equal(feFlag(v), true, `frontend must read ${JSON.stringify(v)} as ON`);
    assert.equal(beFlag(v), true, `backend must read ${JSON.stringify(v)} as ON`);
  }
});

test('M-31: the invariant is stated in both files, since they cannot import each other', () => {
  // Separate build targets and separate deployments, so this is comment-enforced.
  assert.match(read('../../frontend/src/flags.js'), /IDENTICAL TO/i);
  assert.match(read('../../frontend/src/flags.js'), /mgmt\/backend\/src\/flags\.js/);
});

// ==================================== M-30: AN UNBOUNDED IN-MEMORY CACHE

test('M-30: the cache is bounded, evicting oldest-first', () => {
  invalidate(''); // clear everything
  assert.equal(_cacheSize(), 0);

  // Keys embed year/parameters ('home:2026', 'profile:USER0123', ...), so a session
  // that browses years and member profiles accumulates entries that are never read
  // again and — before this fix — were therefore never dropped. Each holds a whole
  // view payload, on a phone, in a tab left open all day.
  for (let i = 0; i < 500; i++) setCached(`view:${i}`, { rows: [i] });

  assert.ok(_cacheSize() <= 120, `size must stay bounded, was ${_cacheSize()}`);
  assert.equal(getCached('view:0'), undefined, 'the oldest entries were evicted');
  assert.deepEqual(getCached('view:499'), { rows: [499] }, 'the newest is still there');
});

test('M-30: a legitimately cached falsy value is no longer refetched every time', () => {
  invalidate('');
  // The old useViewData guard was `cached !== undefined && cached !== false`, so a
  // cached `false` was treated as a miss for ever. `undefined` is the only absence
  // sentinel this cache has.
  setCached('flag:x', false);
  setCached('count:y', 0);
  setCached('note:z', '');
  assert.equal(getCached('flag:x'), false);
  assert.equal(getCached('count:y'), 0);
  assert.equal(getCached('note:z'), '');
  assert.equal(getCached('never:set'), undefined, 'only a real miss is undefined');
});

test('M-30: expired entries are swept on write, not only when re-read', () => {
  invalidate('');
  setCached('old:1', 'a');
  assert.equal(_cacheSize(), 1);

  // Age it past the 5-minute TTL without waiting.
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6 * 60 * 1000;
    setCached('new:1', 'b');
    assert.equal(_cacheSize(), 1, 'the stale entry went on write; only the new one remains');
    assert.equal(getCached('old:1'), undefined);
    assert.equal(getCached('new:1'), 'b');
  } finally {
    Date.now = realNow;
  }
});

test('M-30 regression guard: invalidate(prefix) still works', () => {
  invalidate('');
  setCached('home:2026', 1);
  setCached('home:2025', 2);
  setCached('loans:2026', 3);
  invalidate('home:');
  assert.equal(getCached('home:2026'), undefined);
  assert.equal(getCached('home:2025'), undefined);
  assert.equal(getCached('loans:2026'), 3, 'an unrelated prefix survives');
});

// ============================ M-24: useViewData's stale fetcher closure

test('M-24: load() calls the CURRENT fetcher, not the one captured when key changed', () => {
  const src = read('../../frontend/src/useViewData.js');
  assert.match(src, /const fetcherRef = useRef\(fetcher\)/,
    'the fetcher must be read through a ref, or a fetcher capturing a changed prop stays stale');
  assert.match(src, /fetcherRef\.current = fetcher/, 'and the ref must be updated every render');
  assert.match(src, /fetcherRef\.current\(\)/, 'and the call must go through it');
  const code = src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
  assert.ok(!/\n\s*fetcher\(\)/.test(code), 'the direct `fetcher()` call is gone');
});

test('M-24: the `cached !== false` mystery guard is gone', () => {
  const src = read('../../frontend/src/useViewData.js');
  // Strip comments — the explanation quotes the removed condition.
  const code = src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
  assert.ok(!/cached !== false/.test(code),
    '`false` was never a sentinel this cache stores — undefined is the only absence marker');
  // The audit's other complaint was that getCached(key) ran three times per RENDER.
  // Both useState calls must use the lazy function form, which runs once on mount —
  // the argument form is evaluated on every render.
  assert.match(src, /useState\(\(\) => getCached\(key\)\)/, 'data initialiser is lazy');
  assert.match(src, /useState\(\(\) => getCached\(key\) === undefined\)/, 'loading initialiser is lazy');
  assert.ok(!/useState\(!getCached\(key\)\)/.test(code),
    'the eager `useState(!getCached(key))` walked the cache map on every render');
});

// ==================== M-29: a failed dropdown load poisoned every later caller

test('M-29: the in-flight promise is cleared on BOTH outcomes', () => {
  const src = read('../../frontend/src/useDropdownList.js');
  assert.match(src, /\.finally\(\(\) => \{ inflight = null; \}\)/,
    'on rejection the old code left the failed promise in `inflight` for ever, so every '
    + 'later caller re-awaited the same rejection and every dropdown stayed empty until a reload');
  assert.ok(!/if \(inflight && !force\)/.test(src),
    'a forced load must JOIN a running request, not start a second one that races to assign `cache`');
  assert.match(src, /if \(inflight\) return inflight;/);
});

// ============================== L-17 / L-18 / L-19: the public portal

test('L-17: the load handler composes instead of clobbering', () => {
  // Strip comments: the explanatory note quotes the old line verbatim.
  const src = read('../../../Public/frontend/script.js')
    .split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
  assert.ok(!/window\.onload\s*=/.test(src),
    '`window.onload = ...` REPLACES any other load handler — including the GTM snippet');
  assert.match(src, /window\.addEventListener\('load'/);
});

test('L-18: the snapshot path cannot blank the portal on a missing key', () => {
  const src = read('../../../Public/frontend/script.js');
  for (const key of ['collections', 'loans', 'committee']) {
    assert.ok(!new RegExp(`\\bres\\.${key}\\.forEach`).test(src),
      `res.${key}.forEach is unguarded — the last-known-good snapshot can omit it, and this `
      + 'threw on the one code path whose purpose is keeping the portal up when things are wrong');
    assert.match(src, new RegExp(`\\(res\\.${key} \\|\\| \\[\\]\\)\\.forEach`),
      `res.${key} must be defaulted`);
  }
});

test('L-19: the misleading escapeAttr alias is gone and escapeHtml covers both contexts', () => {
  const src = read('../../../Public/frontend/script.js');
  assert.ok(!/function escapeAttr/.test(src), 'the alias implied escaping that did not exist');
  // Only the explanatory comment may still mention the old name.
  const code = src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
  assert.ok(!/escapeAttr\(/.test(code), 'no call sites left');

  // The reason it was safe all along: escapeHtml escapes BOTH quote characters, so
  // an interpolated value cannot terminate either form of quoted attribute.
  const fn = src.slice(src.indexOf('function escapeHtml'), src.indexOf('// audit L-19'));
  assert.match(fn, /replace\(\/"\/g, '&quot;'\)/, 'double quote escaped');
  assert.match(fn, /replace\(\/'\/g, '&#39;'\)/, 'single quote escaped');
});

test('L-19: the JS-string-inside-an-attribute case still escapes for BOTH contexts', () => {
  const src = read('../../../Public/frontend/script.js');
  // A value going into `onclick="fn('...')"` is a third context. It must be escaped
  // for the JS string FIRST (backslash, then quote) and for HTML second.
  const idJsLine = src.split('\n').find(l => l.includes('const idJs ='));
  assert.ok(idJsLine, 'the JS-string escaping step still exists');
  assert.ok(idJsLine.includes('.replace(') && idJsLine.split('.replace(').length === 3,
    `idJs must escape twice — backslash then quote: ${idJsLine.trim()}`);
  assert.match(src, /onclick="app\.selectDownloadPerson\('\$\{escapeHtml\(idJs\)\}'\)"/,
    'and the JS-escaped value is then HTML-escaped');
});

// ==================================== L-21 / P-10: build configuration

test('L-21: the GTM container id comes from the environment, with the shipping default', () => {
  const cfg = read('../../frontend/vite.config.js');
  assert.match(cfg, /process\.env\.VITE_GTM_ID/, 'read from the environment');
  assert.match(cfg, /'GTM-M2JP98W5'/, 'defaulting to the id that has been shipping — not a behaviour change');
  assert.match(cfg, /transformIndexHtml/, 'index.html is not in the JS pipeline, so `define` cannot reach it');

  const html = read('../../frontend/index.html');
  assert.match(html, /var gtmId = __GTM_ID__;/);
  assert.match(html, /if \(!gtmId\) return;/, 'an empty id must ship no analytics at all');
  assert.match(html, /ns\.html\?id=__GTM_ID_RAW__/, 'the noscript iframe uses the injected id too');

  // The literal id may now appear ONLY in the explanatory comment.
  const outsideComments = html.split('\n')
    .filter(l => !/^\s*(<!--|\s{2,}\S.*-->|[A-Za-z].*-->)/.test(l) && !/GTM-M2JP98W5 was the real one/.test(l));
  assert.ok(!outsideComments.some(l => /id=GTM-M2JP98W5|'GTM-M2JP98W5'/.test(l)),
    'no hardcoded id left in the markup');
});

test('P-10: the chunk-size warning is no longer silenced for the entry chunk', () => {
  const cfg = read('../../frontend/vite.config.js');
  const m = cfg.match(/chunkSizeWarningLimit:\s*(\d+)/);
  assert.ok(m, 'the limit is still set explicitly');
  const limit = parseInt(m[1]);
  // 1000 kB was chosen to silence the deliberately-large pdf-utils chunk, which
  // silenced it for the ~191 kB entry chunk too.
  assert.ok(limit < 1000, `raised to ${limit} — must be below the old 1000 kB blanket`);
  assert.ok(limit >= 600, 'but not so low that the known-heavy lazy chunks cry wolf every build');
});

test('L-21: an empty container id ships no googletagmanager request at all', () => {
  const cfg = read('../../frontend/vite.config.js');
  // The <script> half self-disables. The <noscript> iframe cannot, so it is removed
  // from the HTML entirely — otherwise a build with analytics "off" still fired a
  // request to googletagmanager.com with an empty id.
  assert.match(cfg, /GTM_ID\s*\?\s*html\s*:\s*html\.replace/,
    'the noscript iframe must be stripped when no container is configured');
  assert.match(cfg, /<noscript><iframe src="https/, 'and it targets that exact block');
});

// ==================== FEAT-001: the public chatbot renders CLICKABLE links, safely

// The chat widget used to render every bubble with `div.textContent = text`, so a
// Markdown link `[Download](https://…)` or a bare URL in the model's reply showed
// up as raw plain text. The fix linkifies the BOT bubble only, escape-first-then-
// linkify, so the output can only ever contain <a> tags with safeUrl-validated
// http(s) hrefs. These tests extract the THREE real shipped helpers (escapeHtml,
// safeUrl, linkifyBotText) from the source text and run them, so they exercise the
// code that actually ships rather than a re-implementation.

// Slice a top-level `function name(...) { ... }` body out of the source by counting
// braces from the first `{` after the signature. Used for the two `function` decls.
function sliceFunction(src, name) {
  const start = src.indexOf('function ' + name);
  assert.ok(start >= 0, `source must define function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Slice the `linkifyBotText: (…) => { … },` arrow method out of the app object and
// return the arrow expression as source (so it can be assigned to a const). Brace
// counting is unreliable here because the body contains `{`/`}` inside a regex
// character class, so we anchor on the method that follows it in the source.
function sliceLinkify(src) {
  const start = src.indexOf('linkifyBotText:');
  assert.ok(start >= 0, 'source must define app.linkifyBotText');
  const argsStart = src.indexOf('(', start);
  // The method ends at the `},` immediately before the appendChatMsg method.
  const nextMethod = src.indexOf('appendChatMsg:', start);
  assert.ok(nextMethod > start, 'appendChatMsg must follow linkifyBotText');
  const end = src.lastIndexOf('}', nextMethod);
  assert.ok(end > argsStart, 'linkifyBotText body must close before appendChatMsg');
  return src.slice(argsStart, end + 1);
}

// Build the three REAL functions in a fresh scope from the shipped source text.
function loadFrontendHelpers() {
  const src = read('../../../Public/frontend/script.js');
  const escapeHtmlSrc = sliceFunction(src, 'escapeHtml');
  const safeUrlSrc = sliceFunction(src, 'safeUrl');
  const linkifySrc = sliceLinkify(src);
  const factory = new Function(
    escapeHtmlSrc + '\n' + safeUrlSrc + '\n' +
    'const linkifyBotText = ' + linkifySrc + ';\n' +
    'return { escapeHtml, safeUrl, linkifyBotText };'
  );
  return factory();
}

const FE = loadFrontendHelpers();
const linkify = (t) => FE.linkifyBotText(t, FE.escapeHtml, FE.safeUrl);

test('FEAT-001(a): a Markdown link becomes a clickable <a> with the safe rel/target', () => {
  assert.equal(
    linkify('[Download](https://x/y.pdf)'),
    '<a href="https://x/y.pdf" target="_blank" rel="noopener noreferrer nofollow">Download</a>'
  );
});

test('FEAT-001(b): a bare https URL becomes an <a> whose href equals that URL', () => {
  const url = 'https://files-chhath.shaharpura.com/2026/pdf/receipt-NCS-2026-64.pdf';
  const out = linkify('Your receipt: ' + url);
  assert.match(out, /^Your receipt: <a /);
  assert.match(out, new RegExp('href="' + url.replace(/[.\/]/g, m => '\\' + m) + '"'));
  assert.match(out, /target="_blank" rel="noopener noreferrer nofollow"/);
  // The visible label for a bare URL is the URL text itself.
  assert.match(out, new RegExp('>' + url.replace(/[.\/]/g, m => '\\' + m) + '</a>'));
});

test('FEAT-001(b2): a trailing sentence period is kept out of the href', () => {
  const url = 'https://x/y.pdf';
  const out = linkify('see ' + url + '.');
  assert.equal(out, 'see <a href="https://x/y.pdf" target="_blank" rel="noopener noreferrer nofollow">https://x/y.pdf</a>.');
});

test('FEAT-001(c): dangerous schemes are NOT linked and remain inert escaped text', () => {
  // Built via concatenation so no suspicious literal appears in the file.
  const js = 'java' + 'script:' + 'alert(1)';
  const dataUri = 'da' + 'ta:text/html,' + '<b>x</b>';
  const mdOut = linkify('[click](' + js + ')');
  assert.ok(!/<a /.test(mdOut), 'a javascript: Markdown link must NOT become an <a>');
  assert.ok(mdOut.includes('java' + 'script:'), 'it survives only as inert escaped text');

  const dataOut = linkify('open ' + dataUri);
  assert.ok(!/<a /.test(dataOut), 'a data: URI must NOT become an <a>');
  // The angle brackets inside the data: URI are escaped, proving no live markup.
  assert.ok(dataOut.includes('&lt;b&gt;'), 'the data: payload is HTML-escaped');
});

test('FEAT-001(d): raw HTML in the reply is escaped and cannot execute', () => {
  const imgOut = linkify('<img src=x onerror=alert(1)>');
  assert.ok(imgOut.includes('&lt;img'), 'the tag is escaped');
  assert.ok(!/<img/.test(imgOut), 'no live <img element is emitted');

  const scriptOut = linkify('</a><scr' + 'ipt>alert(1)</scr' + 'ipt>');
  assert.ok(scriptOut.includes('&lt;scr' + 'ipt'), 'the script tag is escaped');
  assert.ok(!/<scr/i.test(scriptOut), 'no live <script element is emitted');
  assert.ok(!/<\/a>/.test(scriptOut) || scriptOut.includes('&lt;/a&gt;'),
    'a fake closing </a> is escaped, it cannot break out of any real anchor');
});

test('FEAT-001(e): plain text with no URL is returned unchanged (except HTML-escaping)', () => {
  assert.equal(linkify('hello world'), 'hello world');
  assert.equal(linkify('a & b'), 'a &amp; b');
});

test('FEAT-001: appendChatMsg linkifies the BOT bubble via innerHTML, user+error stay textContent', () => {
  const src = read('../../../Public/frontend/script.js');
  // Isolate the appendChatMsg method body.
  const start = src.indexOf('appendChatMsg:');
  assert.ok(start >= 0, 'appendChatMsg must exist');
  const braceStart = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const body = src.slice(start, i);

  // The bot path must render through linkifyBotText into innerHTML.
  assert.match(body, /div\.innerHTML = app\.linkifyBotText\(text, escapeHtml, safeUrl\)/,
    'the bot bubble must be linkified into innerHTML');
  // Strip comments, then assert user + error still use textContent and that raw
  // text is never assigned to innerHTML directly.
  const code = body.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
  assert.match(code, /kind === 'user' \|\| kind === 'error'/,
    'user + error are handled explicitly so they keep textContent');
  assert.match(code, /div\.textContent = text;/,
    'user + error bubbles must still use textContent');
  assert.ok(!/innerHTML = text\b/.test(code),
    'raw untrusted text must never be assigned to innerHTML directly');
});

test('FEAT-001: the escape-first-then-linkify ordering is documented in the source', () => {
  const src = read('../../../Public/frontend/script.js');
  assert.match(src, /escape-FIRST-then-linkify/i,
    'the security-critical ordering must be explained for future editors');
  // linkifyBotText escapes the whole reply before any regex runs.
  const fn = sliceLinkify(src);
  assert.match(fn, /escapeHtmlFn\(text\)/, 'the entire reply is escaped first');
  assert.match(fn, /safeUrlFn\(/, 'and every candidate URL passes through safeUrl');
  assert.match(fn, /rel="noopener noreferrer nofollow"/, 'emitted links carry the safe rel');
});
