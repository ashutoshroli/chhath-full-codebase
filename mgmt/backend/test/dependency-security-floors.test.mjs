// audit PR-47 (slice) — a lockfile may not pin a version we have decided is unsafe.
//
// THE BUG THIS EXISTS BECAUSE OF.
//
// Both mgmt frontends declared an override redirecting the deprecated `xmldom` to
// `@xmldom/xmldom@^0.9.12`, and the CI workflow even carries a comment explaining
// that `npm ci` is used precisely so that override is honoured. It looked handled.
//
// It was not. Two DIFFERENT packages pull this library in:
//
//   docxtemplater                     -> @xmldom/xmldom@^0.9.10   (the scoped name)
//   docxtemplater-image-module-free   -> xmldom@^0.1.27           (the deprecated name)
//
// The override only rewrote requests for the second one. `docxtemplater`'s own
// dependency on the SCOPED name was never touched — and `^0.9.10` is satisfied by
// both 0.9.11 (vulnerable: 11 advisories, high) and 0.9.12 (patched). So which one
// you got came down to when the lockfile happened to be generated:
//
//   mgmt/frontend          locked 0.9.11   <- vulnerable, and this is what `npm ci` installed
//   mgmt/frontend-svelte   locked 0.9.12   <- patched, by luck
//
// `npm install --package-lock-only` will not correct it either, because 0.9.11 does
// satisfy `^0.9.10` — npm has no reason to move a pin that is already valid. Nothing
// errored, nothing warned, and the difference between the two apps was invisible.
//
// WHY THE CHECK IS SHAPED LIKE THIS.
//
// It does not ask "is every `overrides` entry respected?" — that would have passed
// happily here, because the override that existed WAS respected; it just named the
// wrong package. And it does not run `npm audit`, because that answer changes with
// the advisory database and would turn CI red on a day when nobody touched anything.
//
// It asks the one question that matters: **is a version of this library that we have
// decided is unsafe present in any lockfile in this repository?** Keyed on the
// TARBALL rather than the dependency name, so an alias cannot hide a copy.
//
// AND WHY A TEST IS THE FIX, RATHER THAN THE OVERRIDE.
//
// npm does not record `overrides` in the lockfile at all — verified: the root
// `packages[""]` entry has no `overrides` key in either app. So an override is a
// RESOLUTION-TIME hint that applies when `npm install` builds the tree, and
// `npm ci` — which is what CI and every deploy run — simply installs the versions
// the lockfile already names. An override therefore cannot enforce anything on the
// path that actually ships; only the pinned version can, and only this test checks
// the pinned version. The override added alongside this test keeps a future
// `npm install` from re-introducing 0.9.11; the test is what makes it stay fixed.
//
// Run: node --test mgmt/backend/test/dependency-security-floors.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Add an entry when an advisory forces a minimum. The reason is not decoration: the
// next person needs to know whether the floor can be relaxed, and why it is here.
const SECURITY_FLOORS = [
  {
    pkg: '@xmldom/xmldom',
    min: '0.9.12',
    reason:
      '0.9.0-beta.1..0.9.11 carry 11 advisories (high): requireWellFormed bypasses via ' +
      'embedded line terminators, PI/DocType/fragment injection, and quadratic-time ' +
      'parsing and attribute deduplication. This library parses the DOCX templates a ' +
      'Superadmin uploads, in the browser, so the quadratic cases are reachable input.',
  },
];

function trackedLockfiles() {
  const out = execFileSync('git', ['ls-files', '*package-lock.json'], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').map((f) => f.trim()).filter(Boolean).filter((f) => !f.includes('node_modules'));
}

/** -1 / 0 / 1. A prerelease sorts BELOW the release it prefixes, which is the safe way round. */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre] = String(v).split('-', 2);
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre || null };
  };
  const A = split(a);
  const B = split(b);
  for (let i = 0; i < 3; i++) {
    if (A.nums[i] !== B.nums[i]) return A.nums[i] < B.nums[i] ? -1 : 1;
  }
  if (A.pre && !B.pre) return -1; // 0.9.12-beta < 0.9.12
  if (!A.pre && B.pre) return 1;
  if (A.pre && B.pre) return A.pre === B.pre ? 0 : (A.pre < B.pre ? -1 : 1);
  return 0;
}

/**
 * Every installed copy of `pkg` in a lockfile, found by the TARBALL it resolves from
 * rather than the key it is installed under — an aliased entry
 * (`xmldom` -> `@xmldom/xmldom`) is the same code and must be held to the same floor.
 */
function installedCopies(lock, pkg, { by }) {
  const found = [];
  for (const [path, entry] of Object.entries(lock.packages || {})) {
    if (!entry || !entry.version) continue;
    const matches = by === 'tarball'
      // Any copy of this CODE, whatever name it sits under. An aliased entry
      // (`xmldom` -> `@xmldom/xmldom`) is the same library and the same advisory.
      ? (entry.resolved || '').includes(`/${pkg}/-/`)
      // Only copies installed UNDER this name — which is the scope an `overrides`
      // entry actually governs.
      : (path === `node_modules/${pkg}` || path.endsWith(`/node_modules/${pkg}`));
    if (matches) found.push({ path, version: entry.version });
  }
  return found;
}

describe('no lockfile pins a version we have ruled out', () => {
  const lockfiles = trackedLockfiles();

  test('the scan actually finds the lockfiles', () => {
    // A glob that matched nothing would make the real assertion below vacuous.
    assert.ok(lockfiles.length >= 3, `only found ${lockfiles.length}: ${lockfiles.join(', ')}`);
    for (const expected of ['mgmt/frontend/package-lock.json', 'mgmt/frontend-svelte/package-lock.json']) {
      assert.ok(lockfiles.includes(expected), `${expected} was not scanned`);
    }
  });

  test('the version comparator is right, including the awkward cases', () => {
    // This comparator decides whether CI passes, so it does not get to be assumed.
    assert.equal(compareVersions('0.9.11', '0.9.12'), -1);
    assert.equal(compareVersions('0.9.12', '0.9.12'), 0);
    assert.equal(compareVersions('0.9.2', '0.9.11'), -1, 'must compare numerically, not as strings');
    assert.equal(compareVersions('0.10.0', '0.9.12'), 1);
    assert.equal(compareVersions('1.0.0', '0.9.12'), 1);
    assert.equal(compareVersions('0.9.12-beta.1', '0.9.12'), -1, 'a prerelease is below its release');
    assert.equal(compareVersions('0.9', '0.9.0'), 0, 'a short version is padded');
  });

  for (const floor of SECURITY_FLOORS) {
    test(`${floor.pkg} is at least ${floor.min} in every lockfile`, () => {
      const offenders = [];
      let copiesSeen = 0;
      for (const rel of lockfiles) {
        const lock = JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
        for (const copy of installedCopies(lock, floor.pkg, { by: 'tarball' })) {
          copiesSeen++;
          if (compareVersions(copy.version, floor.min) < 0) {
            offenders.push(`${rel} :: ${copy.path} = ${copy.version} (needs >= ${floor.min})`);
          }
        }
      }
      // If nothing was found at all, the lookup is broken rather than the tree clean.
      assert.ok(copiesSeen > 0, `found no copies of ${floor.pkg} in any lockfile — is the lookup still correct?`);
      assert.deepEqual(offenders, [], `\n${floor.reason}\n\n  ${offenders.join('\n  ')}\n`);
    });
  }

  test('an override that names a package still has to be reflected in the lockfile', () => {
    // Secondary, and deliberately not the primary check — the xmldom bug proved an
    // override can be faithfully applied and still leave a vulnerable copy behind,
    // because it named the wrong package. This catches the OTHER failure: an override
    // that was declared and then quietly not honoured.
    //
    // It matches by NAME, not by tarball, so it genuinely tests that second property
    // rather than re-detecting the floor violation above through the back door.
    const pkgFiles = execFileSync('git', ['ls-files', '*package.json'], { cwd: REPO, encoding: 'utf8' })
      .split('\n').map((f) => f.trim())
      .filter((f) => f && !f.includes('node_modules'));

    let checked = 0;
    for (const rel of pkgFiles) {
      const pkg = JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
      if (!pkg.overrides) continue;
      const lockRel = rel.replace(/package\.json$/, 'package-lock.json');
      if (!lockfiles.includes(lockRel)) continue;
      const lock = JSON.parse(readFileSync(join(REPO, lockRel), 'utf8'));

      for (const [name, spec] of Object.entries(pkg.overrides)) {
        // Only the two forms this repo uses. Anything else must FAIL loudly rather
        // than be skipped, or a new syntax would silently stop being checked.
        const alias = /^npm:(@?[^@]+(?:\/[^@]+)?)@(.+)$/.exec(spec);
        const range = alias ? alias[2] : spec;
        const caret = /^\^(\d+\.\d+\.\d+)$/.exec(range);
        assert.ok(caret, `${rel}: override "${name}": "${spec}" uses a range this test cannot check`);

        // Look up the OVERRIDE KEY, not the alias target. For `xmldom ->
        // npm:@xmldom/xmldom@^0.9.12` the governed copy is installed as `xmldom`;
        // the target only says where its code comes from. Searching the target
        // instead made this test re-find the unrelated scoped copy and fail for the
        // wrong reason, which is how it initially looked like it was working.
        for (const copy of installedCopies(lock, name, { by: 'name' })) {
          checked++;
          assert.ok(
            compareVersions(copy.version, caret[1]) >= 0,
            `${lockRel} :: ${copy.path} = ${copy.version}, below the override ${name} -> ${spec}`
          );
        }
      }
    }
    assert.ok(checked > 0, 'no override-covered packages were checked — the walk found nothing');
  });
});
