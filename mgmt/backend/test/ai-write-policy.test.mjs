// ============ WHAT THE AI IS ALLOWED TO WRITE ============
//
// audit Render/offload #7. The AI fix loop reads an error, asks a model for a unified diff,
// and commits it to a branch. What it could touch was decided by a DENYLIST: `.env*`,
// `wrangler.toml`, `*.secret`, `mgmt/db/**.sql`, and names containing secret/key/token/
// password/credential/.pem.
//
// A denylist fails OPEN, and the paths nobody listed are the dangerous ones:
//
//   * `.github/workflows/*.yml` is CODE THAT RUNS IN CI WITH THE REPOSITORY'S SECRETS. An AI
//     that can edit a workflow can exfiltrate every secret the repo has on the next push.
//   * `package.json` / lockfiles are dependency substitution and a `postinstall` hook that
//     runs arbitrary code on every install, in CI and on Render.
//   * `vercel.json`, `render.yaml`, `Dockerfile`, `vite.config.ts` decide what runs where.
//
// And the model's input is UNTRUSTED: error messages, source, and CI logs — text a third
// party can put there. A model cannot tell an instruction from data, so the boundary is here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  WRITABLE_ROOTS,
  WRITABLE_EXTENSIONS,
  normalizeWritePath,
  checkWritablePath,
  checkDiffWithinContext,
  checkBranchName,
} from '../src/aiWritePolicy.js';
import { isBlockedPath } from '../src/aiFix.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const can = (p) => checkWritablePath(p, isBlockedPath);

describe('the two copies of the policy cannot drift', () => {
  test('the policy block is byte-identical in the Worker and in Render', () => {
    const S = '// ---- 8< ---- POLICY (kept byte-identical in both copies) ---- 8< ----';
    const E = '// ---- 8< ---- END POLICY ---- 8< ----';
    const extract = (src, label) => {
      const from = src.indexOf(S);
      const to = src.indexOf(E);
      assert.ok(from !== -1 && to > from, `${label}: policy markers missing`);
      return src.slice(from + S.length, to).trim();
    };
    assert.equal(
      extract(read('../src/aiWritePolicy.js'), 'mgmt/backend'),
      extract(read('../../server-render/src/lib/aiWritePolicy.js'), 'server-render'),
      'the AI write policy has drifted between the two deployments'
    );
  });
});

describe('the paths that made this a finding', () => {
  const mustRefuse = [
    '.github/workflows/ci.yml',              // runs in CI with the repo's secrets
    '.github/workflows/deploy.yaml',
    '.github/dependabot.yml',
    'package.json',                          // dependency substitution / postinstall
    'package-lock.json',
    'mgmt/backend/package.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'mgmt/backend/wrangler.toml',
    'Public/backend/wrangler.toml',
    'Public/frontend-v6/vercel.json',
    'render.yaml',
    'Dockerfile',
    'Public/frontend-v6/vite.config.ts',
    'Public/frontend-v6/svelte.config.js',
    'tsconfig.json',
    '.npmrc',
  ];

  for (const p of mustRefuse) {
    test(`refuses ${p}`, () => {
      const v = can(p);
      assert.equal(v.ok, false, `${p} must not be writable by the AI`);
    });
  }

  test('the old denylist accepted the two worst of them', () => {
    // Proof that the shape of the check was the problem, not a missing entry: neither a
    // workflow nor a manifest is caught by a name/extension denylist.
    assert.equal(isBlockedPath('.github/workflows/ci.yml'), false);
    assert.equal(isBlockedPath('package.json'), false);
  });
});

describe('the allowlist accepts real source and nothing else', () => {
  for (const p of [
    'mgmt/backend/src/loans.js',
    'mgmt/backend/test/loans.test.mjs',
    'Public/backend/src/index.js',
    'Public/frontend-v6/src/lib/api/client.ts',
    'Public/frontend-v6/src/lib/components/Modal.svelte',
    'mgmt/frontend-svelte/src/lib/app.css',
    'mgmt/server-render/src/lib/model.js',
  ]) {
    test(`allows ${p}`, () => assert.equal(can(p).ok, true, can(p).error));
  }

  test('a source file OUTSIDE every writable root is refused', () => {
    for (const p of ['README.md', 'docs/POST_AUDIT_MANUAL_STEPS.md', 'mgmt/db/schema/core.sql', 'scripts/deploy.js']) {
      assert.match(can(p).error || '', /outside every writable source root|protected path/, p);
    }
  });

  test('a non-source extension inside a writable root is refused', () => {
    // A manifest or config does not become code by living under src/.
    for (const p of [
      'mgmt/backend/src/config.json',
      'mgmt/backend/src/data.yml',
      'Public/backend/src/notes.txt',
      'mgmt/backend/src/dump.sql',
    ]) {
      assert.equal(can(p).ok, false, p);
    }
    assert.ok(!WRITABLE_EXTENSIONS.includes('.json'), '.json is deliberately not writable');
    assert.ok(!WRITABLE_EXTENSIONS.includes('.yml'));
  });

  test('every writable root is a source tree, not a package root', () => {
    // This is what keeps package.json / wrangler.toml / vercel.json out for free.
    for (const root of WRITABLE_ROOTS) {
      assert.match(root, /\/(src|test)\/$/, `${root} must be a src/ or test/ tree`);
      assert.ok(root.endsWith('/'), `${root} must end with a slash so a prefix match cannot straddle a name`);
    }
  });

  test('the secret denylist still applies INSIDE an allowed root', () => {
    // An allowed root can hold a file whose name says credential.
    assert.equal(can('mgmt/backend/src/apiKeys.js').ok, false);
    assert.equal(can('mgmt/backend/src/tokenStore.js').ok, false);
  });
});

describe('a path cannot escape the tree', () => {
  test('traversal, absolute and backslash paths are refused', () => {
    for (const p of [
      '../../etc/passwd',
      'mgmt/backend/src/../../../.github/workflows/ci.yml',
      '/etc/passwd',
      'mgmt\\backend\\src\\x.js',
      'mgmt/backend/src/./x.js',
      '',
      '   ',
    ]) {
      assert.equal(normalizeWritePath(p) === null || can(p).ok === false, true, JSON.stringify(p));
    }
  });

  test("a diff's a/ and b/ prefixes are stripped, not treated as a directory", () => {
    assert.equal(normalizeWritePath('a/mgmt/backend/src/x.js'), 'mgmt/backend/src/x.js');
    assert.equal(normalizeWritePath('b/mgmt/backend/src/x.js'), 'mgmt/backend/src/x.js');
    assert.equal(can('b/mgmt/backend/src/loans.js').ok, true);
  });
});

describe('the diff may only touch files the model was shown', () => {
  const context = [
    { path: 'mgmt/backend/src/loans.js', sha: 'a' },
    { path: 'mgmt/backend/src/money.js', sha: 'b' },
  ];

  test('a diff within its context is allowed', () => {
    assert.equal(checkDiffWithinContext(['mgmt/backend/src/loans.js'], context).ok, true);
  });

  test('a diff reaching for a file it was never shown is refused', () => {
    // THE containment rule. This is what holds when a CI log or an error message talks the
    // model into editing something else — it does not depend on having enumerated the
    // dangerous paths correctly.
    const v = checkDiffWithinContext(
      ['mgmt/backend/src/loans.js', 'mgmt/backend/src/auth.js'], context);
    assert.equal(v.ok, false);
    assert.match(v.error, /not among the files given to the model/);
  });

  test('the WHOLE diff is refused, not just the extra file', () => {
    // A diff that reached for something it was not asked to is not a diff to partially trust.
    const v = checkDiffWithinContext(['mgmt/backend/src/auth.js'], context);
    assert.equal(v.ok, false);
  });

  test('an empty context refuses everything', () => {
    assert.equal(checkDiffWithinContext(['mgmt/backend/src/loans.js'], []).ok, false);
    assert.equal(checkDiffWithinContext(['mgmt/backend/src/loans.js'], null).ok, false);
  });

  test('context entries may be plain strings or {path} objects', () => {
    assert.equal(checkDiffWithinContext(['mgmt/backend/src/x.js'], ['mgmt/backend/src/x.js']).ok, true);
    assert.equal(checkDiffWithinContext(['mgmt/backend/src/x.js'], [{ path: 'mgmt/backend/src/x.js' }]).ok, true);
  });
});

describe('a branch name cannot climb out of refs/heads', () => {
  test('the fix namespace is accepted', () => {
    assert.equal(checkBranchName('fix/error-ERR123').ok, true);
    assert.equal(checkBranchName('fix/ci-ERR123').ok, true);
  });

  test('anything else is refused', () => {
    for (const b of [
      'main',
      'fix/error-../../main',           // climbs out of refs/heads/
      'fix/error-a b',
      'fix/error-x;rm -rf /',
      'fix/error-x.lock',               // git refuses .lock refs; do not create one
      'fix/error-x/',
      'release/1.0',
      '',
    ]) {
      assert.equal(checkBranchName(b).ok, false, JSON.stringify(b));
    }
  });
});

describe('both write paths are gated', () => {
  test('PR creation uses the allowlist and the context rule', () => {
    const src = read('../../server-render/src/jobs/aiPrCreate.js');
    assert.match(src, /checkWritablePath\(p, isBlockedPath\)/);
    assert.match(src, /checkDiffWithinContext/);
    assert.match(src, /checkBranchName\(branch\)/);
  });

  test('the CI-retry path — the one fed CI LOGS — is gated hardest', () => {
    const src = read('../../server-render/src/jobs/aiCiRetry.js');
    // It used to silently DROP a path it did not like, so a previous diff touching something
    // protected just proceeded without it and nobody was told.
    assert.ok(!/pathsInDiff\(prevDiff\)\.filter\(p => !isBlockedPath\(p\)\)/.test(src),
      'silently filtering a refused path must be gone');
    assert.match(src, /checkWritablePath/);
    // The corrected diff must be a subset of what the previous diff touched.
    assert.match(src, /checkDiffWithinContext\(appliedPaths, paths\)/);
  });

  test('nothing enables GitHub auto-merge', () => {
    // An auto-merged AI PR would land without review. Asserted so it stays that way.
    for (const f of [
      '../../server-render/src/jobs/aiPrCreate.js',
      '../src/aiFix.js',
    ]) {
      assert.ok(!/auto_?merge/i.test(read(f)), `${f} must not enable auto-merge`);
    }
  });
});
