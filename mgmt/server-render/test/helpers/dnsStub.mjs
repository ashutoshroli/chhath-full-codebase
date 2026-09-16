// Provider calls resolve the base URL's hostname before sending the API key anywhere
// (audit Render/offload #6 — see src/lib/providerUrl.js for why). Suites that exercise a
// model call therefore need a resolver, because the fixtures use `.test` hostnames and
// `.test` is a reserved TLD that never resolves. Refusing an unresolvable host is the
// correct production behaviour, so the fixtures get a resolver rather than the policy
// getting an escape hatch.
//
// This maps ANY hostname to one fixed PUBLIC address, which is what these suites want: they
// are about provider fall-through, prompts and error handling, not about SSRF. The policy's
// own suite (`providerUrl.test.mjs`) stubs specific answers instead, including private ones.
import dns from 'node:dns';

const PUBLIC_ADDRESS = '93.184.216.34'; // example.com — unambiguously public

let realLookup = null;

/** Makes every hostname resolve to a public address. Call in a suite's setup. */
export function installPublicDns() {
  if (!realLookup) realLookup = dns.promises.lookup;
  dns.promises.lookup = async () => [{ address: PUBLIC_ADDRESS, family: 4 }];
}

/** Restores the real resolver. */
export function restoreDns() {
  if (realLookup) {
    dns.promises.lookup = realLookup;
    realLookup = null;
  }
}
