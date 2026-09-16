// ============ THE CHAT'S PRIVACY CLAIMS ARE NOW TRUE ============
//
// audit Render/offload #9. Three things that looked like protections and were not.
//
// 1. TLS VERIFICATION WAS OFF.
//
//        ssl: { rejectUnauthorized: false }, // Neon requires TLS; managed cert
//
//    The comment is a true statement that does not justify the code. Requiring TLS and
//    VERIFYING it are different things: with verification off the connection is encrypted but
//    UNAUTHENTICATED, so anything in the path presents its own certificate and reads — and
//    rewrites — everything crossing it. What crosses it is every public chat question and
//    answer, plus the visitor IP pseudonyms. Neon serves a publicly-trusted certificate, so
//    there was nothing to work around.
//
// 2. THE IP "HASH" WAS REVERSIBLE. `sha256(ip)` with no secret is 2^32 candidates for IPv4 — a
//    few minutes of a laptop's time to build the whole table. The stored value was the
//    visitor's address with extra steps, kept indefinitely.
//
// 3. THE SESSION ID CAME FROM THE CALLER. It was read straight out of the request body and
//    used as the key that groups a conversation, so any caller could append their questions to
//    somebody else's history, or shard the table with one arbitrary string per request.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'webhook-secret';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.DRIVE_OAUTH_CLIENT_ID ||= 'cid';
process.env.DRIVE_OAUTH_CLIENT_SECRET ||= 'csec';
process.env.DRIVE_OAUTH_REFRESH_TOKEN ||= 'rtok';
process.env.CHAT_IP_HASH_SECRET = 'ip-pseudonym-secret';

const { hashIp, ipPeriod, newChatSessionId, resolveChatSessionId } =
  await import('../src/lib/neon.js');
const { config } = await import('../src/config.js');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('TLS to Neon is verified', () => {
  const src = read('../src/lib/neon.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('verification is not disabled unconditionally any more', () => {
    // Comments are stripped first: the fix DESCRIBES the old line, and a test that cannot tell
    // code from prose would be satisfied by deleting the explanation.
    assert.ok(!/ssl:\s*\{\s*rejectUnauthorized:\s*false\s*\}\s*,/.test(code),
      'the unconditional rejectUnauthorized: false must be gone');
    assert.match(code, /rejectUnauthorized: true/);
  });

  test('the escape hatch is opt-in and named for what it is', () => {
    // So nobody turns it off by accident, or leaves it off without having typed the reason.
    assert.match(code, /config\.neonAllowUnverifiedTls/);
    assert.equal(config.neonAllowUnverifiedTls, false, 'and it is OFF by default');
  });
});

describe('the IP pseudonym is actually a pseudonym', () => {
  test('it is keyed on a secret, so a 2^32 sweep is useless', () => {
    const a = hashIp('203.0.113.9');
    assert.ok(a);
    // The bare sha256 an attacker would precompute must not be the stored value.
    const naive = createHash('sha256').update('203.0.113.9').digest('hex').slice(0, 32);
    assert.notEqual(a, naive, 'the stored value must not be a plain hash of the address');
  });

  test('it rotates, so one visitor does not carry a stable identifier for ever', () => {
    const jan = Date.parse('2026-01-10T00:00:00Z');
    const feb = Date.parse('2026-02-10T00:00:00Z');
    assert.equal(ipPeriod(jan), '2026-01');
    assert.equal(ipPeriod(feb), '2026-02');
    // Linkability across months is what turns "these requests came together" into a history.
    assert.notEqual(hashIp('203.0.113.9', jan), hashIp('203.0.113.9', feb));
  });

  test('it is stable WITHIN a period, so correlation still works where it is needed', () => {
    const d1 = Date.parse('2026-01-02T00:00:00Z');
    const d2 = Date.parse('2026-01-27T00:00:00Z');
    assert.equal(hashIp('203.0.113.9', d1), hashIp('203.0.113.9', d2));
  });

  test('different addresses do not collide', () => {
    const now = Date.now();
    assert.notEqual(hashIp('203.0.113.9', now), hashIp('203.0.113.10', now));
  });

  test('with NO secret it stores nothing rather than something reversible', () => {
    // The important choice. An unset secret must not silently mean "store a value that looks
    // protected and is not". Chat logging is best-effort and never blocks an answer, so the
    // cost is a missing column, not a broken chatbot.
    const before = config.chatIpHashSecret;
    config.chatIpHashSecret = '';
    try {
      assert.equal(hashIp('203.0.113.9'), '');
    } finally { config.chatIpHashSecret = before; }
  });

  test('an empty address yields nothing', () => {
    assert.equal(hashIp(''), '');
    assert.equal(hashIp(null), '');
  });
});

describe('the session id is issued by the server', () => {
  test('an issued id round-trips and is recognised', () => {
    const id = newChatSessionId();
    assert.match(id, /^[0-9a-f-]{36}\.[0-9a-f]{16}$/);
    const r = resolveChatSessionId(id);
    assert.equal(r.sessionId, id);
    assert.equal(r.issued, false, 'a client may keep using the id it was given');
  });

  test('a forged or borrowed id is replaced, not trusted', () => {
    // THE finding: this used to be accepted verbatim and used as the conversation key, so a
    // caller could append to someone else's history.
    for (const forged of [
      'someone-elses-session',
      '11111111-1111-1111-1111-111111111111.0000000000000000',   // right shape, wrong signature
      'a'.repeat(80),
      '',
      null,
      undefined,
      '11111111-1111-1111-1111-111111111111',                     // unsigned
    ]) {
      const r = resolveChatSessionId(forged);
      assert.equal(r.issued, true, `must not trust ${JSON.stringify(forged)}`);
      assert.notEqual(r.sessionId, forged);
      assert.match(r.sessionId, /^[0-9a-f-]{36}\.[0-9a-f]{16}$/);
    }
  });

  test('two issued ids differ', () => {
    assert.notEqual(newChatSessionId(), newChatSessionId());
  });

  test('the signature is checked in constant time', () => {
    // The comparison is over a secret-derived value, so the time it takes must not reveal how
    // much of a guess was right.
    assert.match(read('../src/lib/neon.js'), /timingSafeEqual/);
  });

  test('the route no longer reads the id out of the body', () => {
    const src = read('../src/routes/publicChat.js');
    assert.ok(!/const sessionId = \(\(req\.body && req\.body\.sessionId\) \|\| ''\)/.test(src),
      'the body-supplied session id must be gone');
    assert.match(src, /resolveChatSessionId\(req\.body && req\.body\.sessionId\)/);
  });

  test('a newly issued id is returned so the widget can keep the conversation', () => {
    const src = read('../src/routes/publicChat.js');
    assert.match(src, /session\.issued \? \{ sessionId \} : \{\}/);
  });
});
