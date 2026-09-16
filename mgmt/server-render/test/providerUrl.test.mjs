// ============ THE DNS HALF OF THE SSRF POLICY (Render side) ============
//
// audit Render/offload #6. The shape rules are covered on the Worker side (which also
// drift-checks that both copies are identical). What only THIS deployment can do is
// resolve the hostname: Node has `dns`, workerd does not.
//
// That matters because shape rules are defeated by one DNS record. `evil.example` is a
// perfectly public-looking name that satisfies every syntactic check, and its A record can
// be `127.0.0.1` — or `169.254.169.254`. Without resolution, the provider's API key goes to
// the cloud metadata service and the response is returned as the model's answer.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.DRIVE_OAUTH_CLIENT_ID ||= 'cid';
process.env.DRIVE_OAUTH_CLIENT_SECRET ||= 'csec';
process.env.DRIVE_OAUTH_REFRESH_TOKEN ||= 'rtok';

const {
  assertResolvesPublicly,
  assertProviderUrlAtUse,
  allowHostsFromEnv,
  PROVIDER_FETCH_OPTS,
} = await import('../src/lib/providerUrl.js');

const realLookup = dns.promises.lookup;
/** Pins what a hostname resolves to, so the policy can be tested without the network. */
function stubDns(map) {
  dns.promises.lookup = async (hostname) => {
    if (!(hostname in map)) {
      const e = new Error('getaddrinfo ENOTFOUND');
      e.code = 'ENOTFOUND';
      throw e;
    }
    const v = map[hostname];
    if (v instanceof Error) throw v;
    return v.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}
afterEach(() => { dns.promises.lookup = realLookup; delete process.env.AI_PROVIDER_HOST_ALLOWLIST; });

describe('a public-looking name that resolves inward is refused', () => {
  test('an A record of 127.0.0.1 is refused', async () => {
    stubDns({ 'evil.example': ['127.0.0.1'] });
    await assert.rejects(() => assertResolvesPublicly('evil.example'), /private or loopback/);
  });

  test('an A record of the cloud metadata address is refused', async () => {
    stubDns({ 'looks-fine.example': ['169.254.169.254'] });
    await assert.rejects(() => assertResolvesPublicly('looks-fine.example'), /private or loopback/);
  });

  test('EVERY address is checked, not just the first', async () => {
    // A name with a public record AND a private one would otherwise pass whenever the
    // resolver happened to order them favourably — the same class of bug as trusting the
    // first X-Forwarded-For entry.
    stubDns({ 'mixed.example': ['93.184.216.34', '10.0.0.7'] });
    await assert.rejects(() => assertResolvesPublicly('mixed.example'), /private or loopback/);

    stubDns({ 'mixed2.example': ['10.0.0.7', '93.184.216.34'] });
    await assert.rejects(() => assertResolvesPublicly('mixed2.example'), /private or loopback/);
  });

  test('an IPv6 unique-local or loopback record is refused', async () => {
    stubDns({ 'v6.example': ['fd00::1'] });
    await assert.rejects(() => assertResolvesPublicly('v6.example'), /private or loopback/);
    stubDns({ 'v6b.example': ['::1'] });
    await assert.rejects(() => assertResolvesPublicly('v6b.example'), /private or loopback/);
  });

  test('an IPv4-mapped IPv6 loopback record is refused', async () => {
    stubDns({ 'mapped.example': ['::ffff:127.0.0.1'] });
    await assert.rejects(() => assertResolvesPublicly('mapped.example'), /private or loopback/);
  });

  test('a genuinely public name is allowed', async () => {
    stubDns({ 'api.openai.com': ['104.18.6.192', '2606:4700::6812:6c0'] });
    await assertResolvesPublicly('api.openai.com'); // must not throw
  });
});

describe('an answer we cannot trust is a refusal, not a pass', () => {
  test('a resolution failure refuses', async () => {
    stubDns({});
    await assert.rejects(() => assertResolvesPublicly('nope.example'), /could not be resolved/);
  });

  test('an empty answer refuses', async () => {
    stubDns({ 'empty.example': [] });
    await assert.rejects(() => assertResolvesPublicly('empty.example'), /no addresses/);
  });

  test('the refusal does not echo the resolved address back', async () => {
    // The address is the answer to a DNS query the caller controls, and this message reaches
    // a log the caller can often read — so it names the host, not what it pointed at.
    stubDns({ 'probe.example': ['10.1.2.3'] });
    await assert.rejects(() => assertResolvesPublicly('probe.example'), (e) => {
      assert.ok(!e.message.includes('10.1.2.3'), `leaked the address: ${e.message}`);
      return true;
    });
  });
});

describe('the full use-time check', () => {
  test('shape is checked BEFORE any resolution', async () => {
    let looked = 0;
    dns.promises.lookup = async () => { looked++; return [{ address: '1.1.1.1', family: 4 }]; };
    await assert.rejects(() => assertProviderUrlAtUse('http://api.openai.com/v1'), /https/);
    assert.equal(looked, 0, 'a URL refused on shape must not cost a DNS query');
  });

  test('a good provider passes both halves and is normalised', async () => {
    stubDns({ 'api.openai.com': ['104.18.6.192'] });
    assert.equal(await assertProviderUrlAtUse('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  });

  test('the allow-list is read from this service’s environment', async () => {
    stubDns({ 'api.groq.com': ['104.18.0.1'], 'api.openai.com': ['104.18.6.192'] });
    process.env.AI_PROVIDER_HOST_ALLOWLIST = 'api.openai.com';
    const allowHosts = allowHostsFromEnv();
    assert.deepEqual(allowHosts, ['api.openai.com']);
    await assert.rejects(() => assertProviderUrlAtUse('https://api.groq.com/openai/v1', { allowHosts }), /allow-list/);
    await assertProviderUrlAtUse('https://api.openai.com/v1', { allowHosts });
  });

  test('provider calls refuse redirects', () => {
    assert.equal(PROVIDER_FETCH_OPTS.redirect, 'error');
  });
});
