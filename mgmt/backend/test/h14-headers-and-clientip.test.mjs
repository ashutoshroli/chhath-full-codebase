// ============ AUDIT H-14 (security headers) + H-13 (third-party IP lookup) ============
//
// Neither frontend shipped any security header. The one that matters most here is
// Referrer-Policy: the consent link carries the consent TOKEN in the URL path
// (/consent/<token>), and that token is the credential for a legally binding
// document — so without a policy it leaks in the Referer of every cross-origin
// subresource the page loads (Google Fonts, a Drive image, an outbound link).
//
// These tests validate the shipped configuration and the CSP allowlist against the
// origins the source actually uses, so a header cannot silently drift or a needed
// origin be forgotten.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const MGMT = readJson('../../frontend/vercel.json');
const PUBLIC = readJson('../../../Public/frontend/vercel.json');

const headerMap = (cfg) => {
  const rule = cfg.headers.find(h => h.source === '/(.*)');
  assert.ok(rule, 'a rule covering every path must exist');
  return Object.fromEntries(rule.headers.map(h => [h.key, h.value]));
};

const cspDirectives = (csp) => Object.fromEntries(
  csp.split(';').map(s => s.trim()).filter(Boolean).map(d => {
    const [name, ...vals] = d.split(/\s+/);
    return [name, vals];
  })
);

for (const [label, cfg] of [['mgmt', MGMT], ['public', PUBLIC]]) {
  test(`H-14 (${label}): the headers that stop token leakage and framing are set`, () => {
    const h = headerMap(cfg);
    // THE critical one — see the file header.
    assert.equal(h['Referrer-Policy'], 'no-referrer');
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
    assert.match(h['Strict-Transport-Security'], /max-age=31536000/);
    assert.ok(h['X-Frame-Options'], 'clickjacking protection must be present');
    assert.ok(h['Permissions-Policy'], 'a permissions policy must be present');
  });

  test(`H-14 (${label}): the CSP ships as Report-Only, so it cannot break the launch`, () => {
    const h = headerMap(cfg);
    assert.ok(h['Content-Security-Policy-Report-Only'], 'a Report-Only CSP must be present');
    assert.equal(h['Content-Security-Policy'], undefined,
      'must NOT be enforcing yet — flip the key name deliberately, after reviewing reports');
  });

  test(`H-14 (${label}): the CSP closes the dangerous directives outright`, () => {
    const d = cspDirectives(headerMap(cfg)['Content-Security-Policy-Report-Only']);
    assert.deepEqual(d['object-src'], ["'none'"], 'no plugins/embeds');
    assert.deepEqual(d['base-uri'], ["'self'"], 'no <base> hijack');
    assert.deepEqual(d['form-action'], ["'self'"], 'no off-site form posts');
    assert.deepEqual(d['default-src'], ["'self'"], 'default must be self, not *');
    assert.ok(d['frame-ancestors'], 'frame-ancestors must be set');
    // No wildcard may appear anywhere in the policy.
    for (const [name, vals] of Object.entries(d)) {
      assert.ok(!vals.includes('*'), `${name} must not be a wildcard`);
      assert.ok(!vals.includes("'unsafe-eval'"), `${name} must not allow unsafe-eval`);
    }
  });
}

test('H-14 (mgmt): the consent page keeps the permissions it genuinely needs', () => {
  // The consent flow REQUIRES a live camera capture and geolocation before Accept
  // (loans.js refuses without a photo and coordinates). A blanket
  // Permissions-Policy would have silently broken the whole legal flow.
  const pp = headerMap(MGMT)['Permissions-Policy'];
  assert.match(pp, /camera=\(self\)/, 'camera must stay enabled for the consent page');
  assert.match(pp, /geolocation=\(self\)/, 'geolocation must stay enabled for the consent page');
  assert.match(pp, /microphone=\(\)/, 'microphone is never used and must be denied');
});

test('H-14 (public): camera and geolocation are denied — the public site never uses them', () => {
  const pp = headerMap(PUBLIC)['Permissions-Policy'];
  assert.match(pp, /camera=\(\)/);
  assert.match(pp, /geolocation=\(\)/);
});

// -------- the allowlist must cover every origin the source actually uses --------

// Strips comments so the scan reflects what the code actually CONTACTS. Without
// this, a comment documenting a removed endpoint (which is exactly what device.js
// now carries for api.ipify.org) would read as a live dependency.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* block */
    .replace(/^\s*\/\/.*$/gm, '')       // // whole-line
    .replace(/([^:"'`])\/\/.*$/gm, '$1') // trailing // (not a URL's "//")
    .replace(/<!--[\s\S]*?-->/g, '');   // <!-- html -->
}

function originsUsedBy(paths) {
  const found = new Set();
  const walk = (url) => {
    const st = statSync(url);
    if (st.isDirectory()) {
      for (const f of readdirSync(url)) walk(new URL(`${f}${statSync(new URL(f, url)).isDirectory() ? '/' : ''}`, url));
      return;
    }
    if (!/\.(js|jsx|html)$/.test(url.pathname)) return;
    for (const m of stripComments(readFileSync(url, 'utf8')).matchAll(/https:\/\/([a-z0-9.-]+)/g)) {
      found.add(m[1]);
    }
  };
  for (const p of paths) walk(new URL(p, import.meta.url));
  return found;
}

test('H-14 (mgmt): every origin the SPA fetches from is in connect-src', () => {
  const used = originsUsedBy(['../../frontend/src/', '../../frontend/index.html']);
  const d = cspDirectives(headerMap(MGMT)['Content-Security-Policy-Report-Only']);
  const connect = d['connect-src'].join(' ');

  // These are real runtime fetch targets, verified in the source:
  //   mgmt-chhath...   api.js  (VITE_API_URL)
  //   inputtools...    transliterate.js — the Hindi transliteration API
  assert.match(connect, /mgmt-chhath\.shaharpura\.com/);
  assert.ok(used.has('inputtools.google.com'), 'sanity: transliterate.js still calls Input Tools');
  assert.match(connect, /inputtools\.google\.com/,
    'the transliteration API must be allowed or Hindi name entry breaks');

  // The IP-lookup origin must be GONE from both the source and the policy (H-13).
  assert.ok(!used.has('api.ipify.org'), 'the third-party IP lookup must be removed from the source');
  assert.ok(!connect.includes('ipify'), 'and must not be reintroduced into the policy');
});

test('H-14 (mgmt): every image host the SPA renders is in img-src', () => {
  const d = cspDirectives(headerMap(MGMT)['Content-Security-Policy-Report-Only']);
  const img = d['img-src'].join(' ');
  // driveUrl.js documents exactly these two Drive hosts as the embeddable ones.
  for (const host of ['lh3.googleusercontent.com', 'drive.google.com', 'files-chhath.shaharpura.com']) {
    assert.ok(img.includes(host), `${host} must be allowed or images silently break`);
  }
  // jsPDF / html2canvas / QR data-URLs / camera capture.
  assert.ok(img.includes('data:') && img.includes('blob:'), 'data: and blob: are required by the PDF and QR paths');
});

test('H-14 (public): the public CSP allows its Worker and its image hosts', () => {
  const d = cspDirectives(headerMap(PUBLIC)['Content-Security-Policy-Report-Only']);
  assert.match(d['connect-src'].join(' '), /chhath-public-worker\.shaharpura\.com/);
  assert.match(d['img-src'].join(' '), /lh3\.googleusercontent\.com/);
  // The public site never needs blob: — it builds no PDFs.
  assert.ok(!d['img-src'].includes('blob:'), 'the public policy should stay tighter than mgmt');
});

// ------------------------------------------------- H-13: the IP lookup is gone

test('H-13: no source file fetches a third-party IP service', () => {
  const used = originsUsedBy(['../../frontend/src/', '../../../Public/frontend/script.js']);
  for (const host of ['api.ipify.org', 'ipapi.co', 'ipinfo.io', 'icanhazip.com']) {
    assert.ok(!used.has(host), `${host} must not be contacted`);
  }
});

test('H-13: api.js no longer sends a client-reported IP', () => {
  const api = readFileSync(new URL('../../frontend/src/api.js', import.meta.url), 'utf8');
  assert.ok(!/getClientIp/.test(api.replace(/\/\/.*$/gm, '')),
    'getClientIp must not be imported or called (comments aside)');
  // The request body must still carry the fields the audit log genuinely uses.
  assert.match(api, /deviceId: getDeviceId\(\)/);
  assert.match(api, /deviceInfo: getDeviceInfo\(\)/);
});

test('H-13: the server still records the unspoofable edge IP', () => {
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  // This is what makes removing the client value safe: the authoritative IP has
  // always come from the Cloudflare edge header, not from the browser.
  assert.match(idx, /CF-Connecting-IP/);
  assert.match(idx, /clientIp: req\.serverIp/, 'the log context must use the server-observed IP');
});
