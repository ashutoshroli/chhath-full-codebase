// ============ WHERE A PROVIDER KEY IS ALLOWED TO BE SENT ============
//
// audit Render/offload #6. An `openai-compatible` AI provider's base URL was validated by
// exactly this:
//
//     if (type === 'openai-compatible' && !/^https?:\/\//.test(baseUrl)) reject
//
// The field is not just a request target. Two things happen to that URL:
//
//   1. the provider's API key is sent to it as a **Bearer token** — so the field really
//      asks "which host would you like the credential handed to". `http://` also puts it
//      on the wire in clear.
//   2. both the Worker (`aiFix.js`) and the Render service fetch it **server-side**, from
//      inside the deployment's own network position. `http://169.254.169.254/…` is the
//      cloud metadata service; `http://10.x` and `http://127.0.0.1` are whatever else is
//      reachable from there — and the response comes back as "the model's answer".
//
// Two layers: SHAPE (both deployments, synchronous — the only thing workerd can do, since
// it has no DNS resolver) and RESOLUTION (Render only, where Node's `dns` can catch a
// public-looking name whose A record is 127.0.0.1).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  checkProviderUrlShape,
  isBlockedAddress,
  parseHostAllowlist,
  assertProviderUrl,
  PROVIDER_FETCH_OPTS,
} from '../src/providerUrl.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ok = (u, opts) => checkProviderUrlShape(u, opts);

describe('the two copies of the policy cannot drift', () => {
  test('the policy block is byte-identical in the Worker and in Render', () => {
    const MARK_START = '// ---- 8< ---- POLICY (kept byte-identical in both copies) ---- 8< ----';
    const MARK_END = '// ---- 8< ---- END POLICY ---- 8< ----';
    const extract = (src, label) => {
      const from = src.indexOf(MARK_START);
      const to = src.indexOf(MARK_END);
      assert.ok(from !== -1, `${label}: policy start marker missing`);
      assert.ok(to > from, `${label}: policy end marker missing`);
      return src.slice(from + MARK_START.length, to).trim();
    };
    const worker = extract(read('../src/providerUrl.js'), 'mgmt/backend');
    const render = extract(read('../../server-render/src/lib/providerUrl.js'), 'server-render');
    assert.equal(worker, render, 'the SSRF policy has drifted between the two deployments');
    assert.ok(worker.includes('isBlockedIpv4'), 'sanity: the block really is the policy');
  });

  test('only the Render copy resolves DNS, and it does so on every address', () => {
    const render = read('../../server-render/src/lib/providerUrl.js');
    assert.match(render, /dns\.promises\.lookup/);
    assert.match(render, /all: true/, 'every address must be checked, not just the first');
    // The Worker must NOT pretend to resolve: workerd has no resolver, and a check that
    // silently does nothing is worse than an absent one.
    assert.ok(!/dns/.test(read('../src/providerUrl.js').replace(/^\s*\/\/.*$/gm, '')),
      'the Worker copy must not reference dns');
  });

  test('the old permissive regex is gone from the save path', () => {
    const code = read('../src/aiConfig.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\^https\?:/.test(code), 'the http-or-https regex must not decide this any more');
    assert.match(code, /assertProviderUrl\(baseUrl, env\)/);
    // And the NORMALISED url is what gets stored, not the raw input.
    assert.ok(!/\.bind\(name, type, baseUrl, model,/.test(code));
    assert.match(code, /normalizedBaseUrl/);
  });
});

describe('http is refused — the key travels to this host', () => {
  for (const url of ['http://api.openai.com/v1', 'http://example.com', 'HTTP://example.com/v1']) {
    test(`refuses ${url}`, () => {
      const v = ok(url);
      assert.equal(v.ok, false);
      assert.match(v.error, /https/);
    });
  }

  test('other schemes are refused too', () => {
    for (const url of ['ftp://example.com', 'file:///etc/passwd', 'gopher://x.example', 'ws://example.com']) {
      assert.equal(ok(url).ok, false, url);
    }
  });

  test('https to a real provider is accepted', () => {
    for (const url of [
      'https://api.openai.com/v1',
      'https://openrouter.ai/api/v1',
      'https://api.groq.com/openai/v1',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    ]) {
      assert.equal(ok(url).ok, true, url);
    }
  });
});

describe('an internal destination is refused', () => {
  const internal = [
    'https://169.254.169.254/latest/meta-data/',   // AWS/GCP metadata — the classic
    'https://169.254.170.2/v2/credentials',        // ECS task role
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://127.0.0.1/v1',
    'https://127.1.2.3/v1',
    'https://10.0.0.5/v1',
    'https://172.16.0.1/v1',
    'https://172.31.255.255/v1',
    'https://192.168.1.1/v1',
    'https://100.64.0.1/v1',                       // carrier NAT
    'https://0.0.0.0/v1',
    'https://255.255.255.255/v1',
    'https://224.0.0.1/v1',                        // multicast
    'https://localhost/v1',
    'https://LOCALHOST/v1',
    'https://api.localhost/v1',
    'https://printer.local/v1',
    'https://vault.internal/v1',
    'https://db.lan/v1',
    'https://[::1]/v1',
    'https://[fe80::1]/v1',
    'https://[fd00::1]/v1',                        // unique-local
    'https://[::ffff:127.0.0.1]/v1',               // IPv4-mapped loopback
    'https://gateway/v1',                          // single label — cannot be public
  ];

  for (const url of internal) {
    test(`refuses ${url}`, () => {
      assert.equal(ok(url).ok, false, `${url} must not receive an API key`);
    });
  }

  test('a trailing dot cannot smuggle localhost past the name checks', () => {
    assert.equal(ok('https://localhost./v1').ok, false);
  });

  test('credentials in the URL are refused', () => {
    const v = ok('https://user:pw@api.openai.com/v1');
    assert.equal(v.ok, false);
    assert.match(v.error, /username or password/);
  });

  test('a public address that merely LOOKS internal is still allowed', () => {
    // 8.8.8.8 and 1.1.1.1 are public. The policy blocks private ranges, not all literals
    // that happen to be addresses — being wrong in that direction would break a legitimate
    // self-hosted endpoint reached by IP.
    assert.equal(isBlockedAddress('8.8.8.8'), false);
    assert.equal(isBlockedAddress('1.1.1.1'), false);
    assert.equal(isBlockedAddress('203.0.113.10'), false);
  });

  test('isBlockedAddress is not fooled by malformed octets', () => {
    assert.equal(isBlockedAddress('999.1.1.1'), true, 'unparseable is refused, not allowed');
    assert.equal(isBlockedAddress(''), true);
    assert.equal(isBlockedAddress(null), true);
  });
});

describe('the optional operator allow-list', () => {
  test('unset means the shape rules alone decide', () => {
    assert.deepEqual(parseHostAllowlist(''), []);
    assert.equal(ok('https://some-new-provider.example/v1', { allowHosts: [] }).ok, true);
  });

  test('configured means only those hosts, including subdomains', () => {
    const allowHosts = parseHostAllowlist('api.openai.com, openrouter.ai');
    assert.equal(ok('https://api.openai.com/v1', { allowHosts }).ok, true);
    assert.equal(ok('https://eu.openrouter.ai/api/v1', { allowHosts }).ok, true, 'subdomain of a listed host');
    const denied = ok('https://api.deepseek.com/v1', { allowHosts });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /allow-list/);
  });

  test('a lookalike domain does not pass as a subdomain', () => {
    const allowHosts = parseHostAllowlist('openai.com');
    // `notopenai.com` ends with `openai.com` as a STRING but is a different registrable
    // domain — the check requires a dot boundary.
    assert.equal(ok('https://notopenai.com/v1', { allowHosts }).ok, false);
    assert.equal(ok('https://api.openai.com/v1', { allowHosts }).ok, true);
  });

  test('the allow-list cannot re-permit an internal host', () => {
    const allowHosts = parseHostAllowlist('localhost, 169.254.169.254');
    assert.equal(ok('https://localhost/v1', { allowHosts }).ok, false);
    assert.equal(ok('https://169.254.169.254/v1', { allowHosts }).ok, false);
  });
});

describe('the Worker entry point and the fetch options', () => {
  test('assertProviderUrl throws a user-facing error and normalises the URL', () => {
    assert.throws(() => assertProviderUrl('http://10.0.0.1/v1', {}), /https/);
    assert.equal(assertProviderUrl('https://api.openai.com/v1/', {}), 'https://api.openai.com/v1');
  });

  test('it reads the allow-list from env', () => {
    const env = { AI_PROVIDER_HOST_ALLOWLIST: 'api.openai.com' };
    assert.equal(assertProviderUrl('https://api.openai.com/v1', env), 'https://api.openai.com/v1');
    assert.throws(() => assertProviderUrl('https://api.groq.com/openai/v1', env), /allow-list/);
  });

  test('every provider call refuses redirects', () => {
    // Without this an allowed public host answers `302 Location:
    // http://169.254.169.254/…` and the runtime follows it with the Authorization header
    // still attached — every check above having passed.
    assert.equal(PROVIDER_FETCH_OPTS.redirect, 'error');

    for (const [file, label] of [['../src/aiFix.js', 'Worker'], ['../../server-render/src/lib/model.js', 'Render']]) {
      const src = read(file);
      const call = src.slice(src.indexOf('callOpenAiCompatible'), src.indexOf('chat/completions') + 2000);
      assert.match(call, /PROVIDER_FETCH_OPTS/, `${label}: the provider fetch must spread the shared options`);
    }
  });

  test('both call sites validate at USE time, not only at save time', () => {
    // A row saved before this check existed can still hold an internal address, so the
    // place the key actually leaves the process has to be able to refuse.
    assert.match(read('../src/aiFix.js'), /assertProviderUrl\(provider\.baseUrl, env\)/);
    assert.match(read('../../server-render/src/lib/model.js'), /assertProviderUrlAtUse\(p\.baseUrl/);
  });
});
