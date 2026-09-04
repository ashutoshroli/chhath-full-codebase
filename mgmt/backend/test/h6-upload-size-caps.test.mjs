// ============ AUDIT H-6 — unbounded base64 decodes ============
//
// base64ToBytes() has always supported a maxBytes option, but only 2 of its 8 call
// sites used it. Everything else — including respondConsent, a PUBLIC no-login
// endpoint — decoded whatever it was handed. A Worker has 128 MB of memory, so one
// anonymous request with a 60 MB base64 photo takes the isolate down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  base64ToBytes, base64ByteLength, cleanBase64,
  MAX_CONSENT_IMAGE_BYTES, MAX_DOCX_BYTES, MAX_GENERIC_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_BYTES,
} from '../src/base64.js';

// Valid, unpadded base64 that decodes to CEIL(n/3)*3 bytes. base64 only encodes in
// 3-byte groups, so an exact arbitrary n is not representable without padding —
// helpers below always compare against base64ByteLength() rather than n itself.
const b64OfBytes = (n) => 'A'.repeat(Math.ceil(n / 3) * 4);
// Valid base64 of a length that is a multiple of 4 (assertValidDocxBase64 requires
// it) and that begins with the ZIP magic "UEsDB" so it looks like a real .docx.
const docxB64OfChars = (chars) => {
  const total = Math.ceil(Math.max(chars, 8) / 4) * 4;
  return ('UEsDB' + 'A'.repeat(total)).slice(0, total);
};

test('H-6: the shared limits are sane and ordered', () => {
  assert.equal(MAX_CONSENT_IMAGE_BYTES, 6 * 1024 * 1024);
  assert.equal(MAX_IMAGE_UPLOAD_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_GENERIC_UPLOAD_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_DOCX_BYTES, 10 * 1024 * 1024);
  // Every limit must stay well under the 128 MB isolate budget even if several
  // decodes are in flight in one request (respondConsent does two).
  assert.ok(MAX_CONSENT_IMAGE_BYTES * 2 < 64 * 1024 * 1024);
});

test('H-6: base64ToBytes enforces maxBytes and reports the real size', () => {
  const tooBig = b64OfBytes(2000);
  assert.throws(
    () => base64ToBytes(tooBig, { label: 'Photo', maxBytes: 1000 }),
    (err) => {
      assert.equal(err.expected, true, 'a user-facing ValidationError, not a 500');
      assert.match(err.message, /Photo is too large/);
      assert.match(err.message, /Maximum allowed is/);
      return true;
    }
  );
  // …and a payload just under the limit still decodes.
  const ok = base64ToBytes(b64OfBytes(999), { label: 'Photo', maxBytes: 1000 });
  assert.ok(ok instanceof Uint8Array);
  assert.ok(ok.length <= 1000);
});

test('H-6: the size check happens WITHOUT decoding (no memory spike to reject)', () => {
  // base64ByteLength is arithmetic on the string length; rejecting a 40 MB payload
  // must not first materialise 40 MB of bytes.
  const huge = b64OfBytes(40 * 1024 * 1024);
  assert.ok(base64ByteLength(cleanBase64(huge)) >= 40 * 1024 * 1024, 'the fixture really is ~40 MB');
  const t0 = process.hrtime.bigint();
  assert.throws(() => base64ToBytes(huge, { label: 'Photo', maxBytes: MAX_CONSENT_IMAGE_BYTES }), /too large/);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // Decoding 40 MB takes far longer than this; rejecting on arithmetic is ~instant.
  assert.ok(ms < 250, `rejection took ${ms.toFixed(1)}ms — it looks like it decoded first`);
});

test('H-6: a data-URL prefix and whitespace are still stripped before measuring', () => {
  const payload = b64OfBytes(300);
  const dirty = 'data:image/jpeg;base64,' + payload.match(/.{1,76}/g).join('\n');
  const bytes = base64ToBytes(dirty, { label: 'Photo', maxBytes: MAX_CONSENT_IMAGE_BYTES });
  assert.equal(bytes.length, base64ByteLength(payload));
});

// ------------------------------------------- NO CALL SITE MAY BE LEFT UNCAPPED

test('H-6: every base64ToBytes call site in the Worker passes maxBytes', () => {
  const dir = new URL('../src/', import.meta.url);
  const offenders = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'base64.js')) {
    const src = readFileSync(new URL(file, dir), 'utf8');
    // Match each call and check the option bag mentions maxBytes.
    const re = /base64ToBytes\(([^;]*?)\)\s*;/gs;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!/maxBytes\s*:/.test(m[1])) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `these base64ToBytes call sites decode without a size cap:\n  ${offenders.join('\n  ')}`);
});

test('H-6: the docx validator rejects an oversized template without decoding', async () => {
  const { uploadDocxTemplate } = await import('../src/docxTemplates.js');
  const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
  const env = { DRIVE_ROOT_FOLDER_ID: 'folder-1' };
  // A well-formed .docx (ZIP magic, length a multiple of 4) that is far too large.
  const huge = docxB64OfChars(Math.ceil((MAX_DOCX_BYTES * 2) / 3) * 4);
  await assert.rejects(
    () => uploadDocxTemplate(env, 'receipt', 2026, huge, 'big.docx', SUPERADMIN),
    (err) => {
      assert.equal(err.expected, true);
      assert.match(err.message, /too large/);
      assert.match(err.message, /10 MB/);
      return true;
    }
  );
});

test('H-6 regression guard: a realistic payload still passes every validator', async () => {
  const { uploadDocxTemplate } = await import('../src/docxTemplates.js');
  const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
  const env = {}; // no DRIVE_ROOT_FOLDER_ID -> must reach the Drive step and stop there
  // ~400 KB filled .docx, the size the browser actually sends.
  const realistic = docxB64OfChars(Math.ceil((400 * 1024) / 3) * 4);
  await assert.rejects(
    () => uploadDocxTemplate(env, 'receipt', 2026, realistic, 'ok.docx', SUPERADMIN),
    /DRIVE_ROOT_FOLDER_ID not configured/,
    'a normal-sized template must pass validation and reach the upload step'
  );
});

test('H-6 regression guard: a normal consent photo is still accepted', () => {
  // The consent page downscales through a canvas to roughly 200-400 KB.
  for (const kb of [50, 200, 400, 1024]) {
    const payload = b64OfBytes(kb * 1024);
    const bytes = base64ToBytes(payload, { label: 'Photo', maxBytes: MAX_CONSENT_IMAGE_BYTES });
    assert.equal(bytes.length, base64ByteLength(payload), `${kb} KB must be accepted`);
    assert.ok(bytes.length >= kb * 1024 && bytes.length < kb * 1024 + 3);
  }
  // …and an original, un-downscaled phone photo (a failed canvas decode) is refused
  // rather than being allowed to exhaust the isolate.
  assert.throws(() => base64ToBytes(b64OfBytes(12 * 1024 * 1024), { label: 'Photo', maxBytes: MAX_CONSENT_IMAGE_BYTES }),
    /too large/);
});
