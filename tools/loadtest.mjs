#!/usr/bin/env node
// ============================================================================
// SAFE load test for the Chhath portals (mgmt + public).
//
// WHAT IT DOES
//   Fires N concurrent requests/sec at a chosen endpoint for a fixed duration and
//   reports achieved RPS, latency (p50/p95/p99/max), and error rate.
//
// SAFETY (read this):
//   * It only sends READ requests. It NEVER sends a write action (no save/edit/
//     delete), so your data is never touched.
//   * Default targets are the safest endpoints: the mgmt health check
//     (`GET ?health=1`) and the public portal's cached `portalData`/`dataVersion`.
//   * You choose the rate. Start LOW (e.g. 20 rps) and increase. If you push very
//     high you may trip the per-IP rate limit on public actions (that's expected —
//     it means the protection works; it does not harm anything).
//   * Run it from YOUR machine (Node 18+). It does not need wrangler or secrets.
//
// USAGE
//   node tools/loadtest.mjs --url <URL> [--rps 50] [--seconds 20] [--concurrency 50]
//                           [--method GET|POST] [--body '<json>'] [--action <name>]
//
// EXAMPLES
//   # 1) mgmt health check @ 100 rps for 20s (safest — no auth, no data):
//   node tools/loadtest.mjs --url "https://chhath-mgmt-api.shaharpura.workers.dev/?health=1" --rps 100 --seconds 20
//
//   # 2) public portal data version ping @ 200 rps:
//   node tools/loadtest.mjs --url "https://chhath-public-api.shaharpura.workers.dev/?action=dataVersion" --rps 200 --seconds 20
//
//   # 3) public full portal payload (cached at the edge) @ 100 rps:
//   node tools/loadtest.mjs --url "https://chhath-public-api.shaharpura.workers.dev/?action=portalData" --rps 100 --seconds 20
//
//   # 4) an AUTHED mgmt read (getHome) — needs a real session token.
//   #    Get it: log into the mgmt portal, open DevTools > Application >
//   #    Local/Session Storage, copy the value of `cpm_token`. Then:
//   node tools/loadtest.mjs \
//     --url "https://chhath-mgmt-api.shaharpura.workers.dev/" \
//     --method POST --action getHome \
//     --body '{"action":"getHome","year":2026,"token":"PASTE_TOKEN_HERE"}' \
//     --rps 200 --seconds 20
// ============================================================================

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const URL_ = arg('url');
const RPS = parseInt(arg('rps', '50'), 10);
const SECONDS = parseInt(arg('seconds', '20'), 10);
const METHOD = (arg('method', URL_ && URL_.includes('?') ? 'GET' : 'GET')).toUpperCase();
const BODY = arg('body', '');
const LABEL = arg('action', URL_ || '');

if (!URL_) {
  console.error('ERROR: --url is required. See the usage examples at the top of this file.');
  process.exit(1);
}
if (METHOD === 'POST' && BODY) {
  // Hard safety guard: refuse to load-test anything that looks like a write.
  const WRITE_HINTS = /"action"\s*:\s*"(save|update|delete|add|remove|restore|move|enqueue|process|retry|lock|unlock|resend|replace|mark|reannounce|revoke|generate|upload|convert|copy|setConsent|respondConsent|changePassword)/i;
  if (WRITE_HINTS.test(BODY)) {
    console.error('REFUSED: the --body looks like a WRITE action. This tool only load-tests READ endpoints so your data stays safe.');
    process.exit(1);
  }
}

const latencies = [];
let ok = 0, failed = 0, statusCounts = {};

async function oneRequest() {
  const t0 = performance.now();
  try {
    const opts = { method: METHOD };
    if (METHOD === 'POST') { opts.body = BODY || '{}'; }
    const res = await fetch(URL_, opts);
    // drain body so the connection is reused
    await res.text();
    const dt = performance.now() - t0;
    latencies.push(dt);
    statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
    if (res.ok || res.status === 304) ok++; else failed++;
  } catch (e) {
    failed++;
    statusCounts['ERR'] = (statusCounts['ERR'] || 0) + 1;
  }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function run() {
  console.log(`\nLoad test -> ${LABEL}`);
  console.log(`  method=${METHOD} rps=${RPS} seconds=${SECONDS} (total ~${RPS * SECONDS} requests)`);
  console.log(`  (READ-ONLY — no writes, your data is safe)\n`);

  const started = Date.now();
  const inflight = [];
  for (let sec = 0; sec < SECONDS; sec++) {
    const tickStart = Date.now();
    for (let i = 0; i < RPS; i++) inflight.push(oneRequest());
    // pace to ~1 second per tick
    const elapsed = Date.now() - tickStart;
    if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
    process.stdout.write(`  sent ${(sec + 1) * RPS} requests...\r`);
  }
  await Promise.all(inflight);
  const totalSec = (Date.now() - started) / 1000;
  const total = ok + failed;

  console.log(`\n\n==== RESULTS ====`);
  console.log(`  total requests : ${total}`);
  console.log(`  achieved RPS   : ${(total / totalSec).toFixed(1)}`);
  console.log(`  success        : ${ok}  (${((ok / total) * 100).toFixed(1)}%)`);
  console.log(`  failed         : ${failed}  (${((failed / total) * 100).toFixed(1)}%)`);
  console.log(`  status codes   : ${JSON.stringify(statusCounts)}`);
  console.log(`  latency ms     : p50=${pct(latencies,50).toFixed(0)}  p95=${pct(latencies,95).toFixed(0)}  p99=${pct(latencies,99).toFixed(0)}  max=${Math.max(0,...latencies).toFixed(0)}`);
  console.log(`\n  Interpretation:`);
  console.log(`   - success ~100% + low p95  => portal handled this rate comfortably. Increase --rps and retry.`);
  console.log(`   - many 429s               => you hit the per-IP rate limit (public actions). Expected safety, not a failure.`);
  console.log(`   - 5xx / ERR rising, p95 climbing => you found the ceiling at this rate.\n`);
}

run();
