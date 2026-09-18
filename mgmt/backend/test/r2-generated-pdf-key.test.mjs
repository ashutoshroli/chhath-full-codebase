// ====== GENERATED-PDF R2 KEY MUST BE DISTINCT PER GENERATION (stale CDN fix) ======
//
// THE BUG: generated report/receipt/certificate PDFs were written to a FIXED,
// timestamp-free R2 key (keyForYear(year,'pdf',name,docType) =>
// 2026/pdf/report_en/Chhath-Puja-Report-2026.pdf), so re-generating OVERWROTE the
// same object at the same public URL. Cloudflare's CDN then kept serving the
// previously cached bytes for up to 4h (observed cf-cache-status: HIT,
// cache-control: max-age=14400). That is why the English Annual Report stayed
// blank to the user even after the server-side PDF was corrected: English had
// been cached blank BEFORE the data fix, while Hindi/Both were generated for the
// first time only after it.
//
// THE FIX (codebase's own precedent, keyForUserPhoto/keyForDonationQr embed
// Date.now() "so a stale CDN copy is never served after a re-upload"):
// keyForGeneratedPdf embeds a per-generation token so every (re)generation is a
// DISTINCT object at a DISTINCT URL, and putToR2 writes a short revalidating
// Cache-Control on the object as defense in depth.
//
// These two tests would FAIL on current main (keyForYear is timestamp-free and
// putToR2 wrote contentType only).
//
// Run: node --test mgmt/backend/test/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  keyForGeneratedPdf, keyForYear, keyForUserPhoto, keyForDonationQr,
  putToR2, GENERATED_PDF_CACHE_CONTROL, r2PublicUrl,
} from '../src/r2.js';
import { makeR2 } from './helpers/stubs.mjs';

const ENV = { R2_FILES: null, R2_PUBLIC_BASE: 'https://files.example.test' };

describe('keyForGeneratedPdf produces a DISTINCT key per generation', () => {
  test('two generations of the SAME report (year/docType/fileName) yield different keys/URLs', async () => {
    const a = keyForGeneratedPdf(2026, 'report_en', 'Chhath-Puja-Report-2026.pdf');
    // Force a later timestamp so the two calls cannot collide within the same ms.
    await new Promise(r => setTimeout(r, 3));
    const b = keyForGeneratedPdf(2026, 'report_en', 'Chhath-Puja-Report-2026.pdf');

    assert.notEqual(a, b, 'each generation must be a distinct object key (no in-place overwrite)');
    assert.notEqual(r2PublicUrl(ENV, a), r2PublicUrl(ENV, b), 'and therefore a distinct public URL');
  });

  test('the 2026/pdf/<docType>/ prefix is preserved (so the Move-to-Drive prefix listing still finds it)', () => {
    const key = keyForGeneratedPdf(2026, 'report_en', 'Chhath-Puja-Report-2026.pdf');
    assert.match(key, /^2026\/pdf\/report_en\//, 'the year/pdf/docType prefix must stay intact');
    // The original filename must survive in the name segment.
    assert.match(key, /Chhath-Puja-Report-2026\.pdf$/);
    // The distinguishing token is a numeric timestamp prefix on the name segment.
    const nameSeg = key.split('/').slice(3).join('/');
    assert.match(nameSeg, /^\d+_Chhath-Puja-Report-2026\.pdf$/, 'name segment carries a Date.now() token');
  });

  test('keyForYear is UNCHANGED for existing non-PDF callers (no regression)', () => {
    // The consent/receipt callers still rely on keyForYear's fixed output.
    assert.equal(keyForYear(2026, 'consent', 'photo_CN1.jpg'), '2026/consent/photo_CN1.jpg');
    assert.equal(keyForYear(2026, 'pdf', 'receipt-2026-45.pdf', 'receipt'), '2026/pdf/receipt/receipt-2026-45.pdf');
  });
});

describe('putToR2 writes the revalidating Cache-Control for generated PDFs only', () => {
  test('a generated PDF put carries httpMetadata.cacheControl = the revalidating value', async () => {
    const r2 = makeR2();
    const env = { R2_FILES: r2, R2_PUBLIC_BASE: 'https://files.example.test' };
    const key = keyForGeneratedPdf(2026, 'report_en', 'Chhath-Puja-Report-2026.pdf');

    const url = await putToR2(env, key, new Uint8Array([1, 2, 3]), 'application/pdf', GENERATED_PDF_CACHE_CONTROL);

    assert.equal(url, r2PublicUrl(env, key));
    const put = r2._puts().find(p => p.key === key);
    assert.ok(put, 'the object must have been put');
    assert.equal(put.opts.httpMetadata.contentType, 'application/pdf');
    assert.equal(put.opts.httpMetadata.cacheControl, 'public, max-age=60, must-revalidate');
    assert.equal(GENERATED_PDF_CACHE_CONTROL, 'public, max-age=60, must-revalidate');
  });

  test('existing non-PDF callers are UNCHANGED (no cacheControl written)', async () => {
    const r2 = makeR2();
    const env = { R2_FILES: r2, R2_PUBLIC_BASE: 'https://files.example.test' };

    // The userPhoto / donationQr / popup / consent callers all call putToR2 with
    // contentType only (the old 4-arg signature), so no cacheControl is set.
    await putToR2(env, keyForUserPhoto('USER0007', 'photo.jpg'), new Uint8Array([9]), 'image/jpeg');
    await putToR2(env, keyForDonationQr('qr.png'), new Uint8Array([9]), 'image/png');

    for (const put of r2._puts()) {
      assert.equal(put.opts.httpMetadata.cacheControl, undefined,
        `non-PDF put must not set cacheControl (key ${put.key})`);
      assert.ok(put.opts.httpMetadata.contentType, 'contentType is still set');
    }
  });
});
