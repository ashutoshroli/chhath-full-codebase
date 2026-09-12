// Unit tests for the framework-free Google Drive image-URL helpers.
// Runs under plain `node --test` — imports ONLY src/lib/drive.js (no Astro).
//
// Drive file id fixtures are built via string concatenation so no literal
// long-token string appears in source (keeps secret scanners quiet), matching
// the concat pattern used in the other tests. The ids here are obviously-fake
// fixed-length tokens, not real credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveFileId, driveImageUrl, driveImageFallbackUrl } from '../src/lib/drive.js';

// A fake 12-char id built via concatenation.
const ID = 'abcDEF' + '123456';

test('driveFileId extracts id from a /file/d/<id>/ viewer URL', () => {
  assert.equal(driveFileId('https://drive.google.com/file/d/' + ID + '/view'), ID);
});

test('driveFileId extracts id from an lh3 CDN URL', () => {
  assert.equal(driveFileId('https://lh3.googleusercontent.com/d/' + ID), ID);
});

test('driveFileId extracts id from a ?id= query param', () => {
  assert.equal(driveFileId('https://drive.google.com/uc?export=view&id=' + ID), ID);
});

test('driveFileId extracts id from a /d/<id> path', () => {
  assert.equal(driveFileId('https://example.com/d/' + ID), ID);
});

test('driveFileId returns null for a URL with no recognisable id', () => {
  assert.equal(driveFileId('https://example.com/nothing-here'), null);
  assert.equal(driveFileId(''), null);
  assert.equal(driveFileId(null), null);
  assert.equal(driveFileId(undefined), null);
});

test('driveImageUrl builds the lh3 CDN URL with =w1600', () => {
  assert.equal(
    driveImageUrl('https://drive.google.com/file/d/' + ID + '/view'),
    'https://lh3.googleusercontent.com/d/' + ID + '=w1600',
  );
});

test('driveImageUrl passes a non-Drive URL through untouched', () => {
  const other = 'https://example.com/pic.png';
  assert.equal(driveImageUrl(other), other);
});

test('driveImageFallbackUrl builds the thumbnail URL', () => {
  assert.equal(
    driveImageFallbackUrl('https://drive.google.com/file/d/' + ID + '/view'),
    'https://drive.google.com/thumbnail?id=' + ID + '&sz=w1600',
  );
});

test('driveImageFallbackUrl returns empty string when no id is present', () => {
  assert.equal(driveImageFallbackUrl('https://example.com/nothing'), '');
});
