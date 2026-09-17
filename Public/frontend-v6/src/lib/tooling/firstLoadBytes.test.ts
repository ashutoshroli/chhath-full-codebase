/**
 * The first-load budget script, tested (audit PR-45).
 *
 * CI now fails a PR based on this script's number, so the number has to be right.
 * A metric that quietly under-counts is worse than no metric: it goes green
 * forever while the thing it claims to protect gets worse. The specific mistakes
 * worth pinning are counting a chunk twice, counting lazily-loaded chunks that a
 * first load never fetches, and silently scoring 0 for a page whose files are
 * missing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/first-load-bytes.mjs');

let dir: string;

/** Write a file of exactly `size` bytes. */
function bytes(path: string, size: number) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'x'.repeat(size));
}

function run(args: string[]) {
  try {
    return { code: 0, stdout: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }), stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'firstload-'));
  const imm = join(dir, '_app/immutable');
  bytes(join(imm, 'entry/start.js'), 100);
  bytes(join(imm, 'chunks/shared.js'), 200);
  // Present in the build but reachable only through import() — a first load must
  // NOT be charged for it. This is the whole point of the metric.
  bytes(join(imm, 'chunks/lazy-skin.js'), 500_000);

  writeFileSync(
    join(dir, 'index.html'),
    `<html><head>
       <link rel="modulepreload" href="/_app/immutable/entry/start.js">
       <link rel="modulepreload" href="/_app/immutable/chunks/shared.js">
     </head><body><script type="module">
       import("/_app/immutable/entry/start.js");
     </script></body></html>`
  );
  writeFileSync(
    join(dir, 'light.html'),
    `<html><head><link rel="modulepreload" href="/_app/immutable/entry/start.js"></head></html>`
  );
  mkdirSync(join(dir, 'nested'), { recursive: true });
  writeFileSync(
    join(dir, 'nested/deep.html'),
    `<html><head><link rel="modulepreload" href="/_app/immutable/chunks/shared.js"></head></html>`
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('what is counted', () => {
  it('sums the modules a page references, counting each one once', () => {
    const { code, stdout } = run(['--dir', dir, '--json']);
    expect(code).toBe(0);
    // index.html names start.js twice (preload + import) and shared.js once.
    expect(JSON.parse(stdout).worst).toMatchObject({
      page: 'index.html',
      bytes: 300,
      modules: 2
    });
  });

  it('ignores chunks that exist but are not on any page\u2019s critical path', () => {
    const report = JSON.parse(run(['--dir', dir, '--json']).stdout);
    // The 500 kB lazy chunk is in the build; no page pays for it.
    expect(report.rows.every((r: { bytes: number }) => r.bytes < 1000)).toBe(true);
  });

  it('reports the worst page, not the average, and finds nested pages', () => {
    const report = JSON.parse(run(['--dir', dir, '--json']).stdout);
    expect(report.rows.map((r: { page: string }) => r.page).sort()).toEqual([
      'index.html',
      'light.html',
      'nested/deep.html'
    ]);
    expect(report.worst.bytes).toBe(300);
  });
});

describe('the budget gate', () => {
  it('passes when the worst page is within the limit', () => {
    expect(run(['--dir', dir, '--limit', '300']).code).toBe(0);
  });

  it('fails, and says which page, when the worst page is over', () => {
    const { code, stderr } = run(['--dir', dir, '--limit', '299']);
    expect(code).toBe(1);
    expect(stderr).toContain('index.html');
    expect(stderr).toContain('299');
  });

  it('passes with no --limit at all (report-only)', () => {
    expect(run(['--dir', dir]).code).toBe(0);
  });
});

describe('refusing to report a number it cannot stand behind', () => {
  it('fails when a page references a file the build did not emit', () => {
    const broken = mkdtempSync(join(tmpdir(), 'firstload-broken-'));
    writeFileSync(
      join(broken, 'index.html'),
      `<link rel="modulepreload" href="/_app/immutable/chunks/gone.js">`
    );
    const { code, stderr } = run(['--dir', broken, '--limit', '999999']);
    // Scoring this page as 0 bytes would be the dangerous outcome: a build that
    // stopped emitting chunks would look like a huge improvement.
    expect(code).toBe(1);
    expect(stderr).toContain('gone.js');
    rmSync(broken, { recursive: true, force: true });
  });

  it('fails when the build directory is missing or has no pages', () => {
    expect(run(['--dir', join(dir, 'does-not-exist')]).code).toBe(1);
    const empty = mkdtempSync(join(tmpdir(), 'firstload-empty-'));
    expect(run(['--dir', empty]).code).toBe(1);
    rmSync(empty, { recursive: true, force: true });
  });
});
