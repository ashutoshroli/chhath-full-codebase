/**
 * The first-load budget script, tested (audit PR-45, corrected in PR-47's prep).
 *
 * CI fails a PR based on this script's number, so the number has to be right. A
 * metric that quietly under-counts is worse than no metric: it goes green forever
 * while the thing it claims to protect gets worse.
 *
 * The mistake this file now pins hardest is the one the first version of the
 * script actually made: trusting `<link rel="modulepreload">` to name the whole
 * critical path. It does not, and how much it misses depends on the bundler —
 * 810 bytes under vite 5 (rollup), 11,109 under vite 8 (rolldown). So the script
 * follows static imports from the modules the HTML names, and these tests hold it
 * to that: an unlisted chunk that is statically imported IS charged, and a
 * dynamically imported one is NOT.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/first-load-bytes.mjs');

let dir: string;

/** Write `body`, padded with a comment to exactly `size` bytes. */
function chunk(path: string, size: number, body = '') {
  mkdirSync(dirname(path), { recursive: true });
  const pad = size - body.length;
  if (pad < 0) throw new Error(`body longer than ${size} bytes`);
  writeFileSync(path, body + 'x'.repeat(pad));
  if (statSync(path).size !== size) throw new Error('fixture size wrong');
}

function run(args: string[]) {
  try {
    return {
      code: 0,
      stdout: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }),
      stderr: ''
    };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const report = (args: string[] = []) => JSON.parse(run(['--dir', dir, '--json', ...args]).stdout);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'firstload-'));
  const imm = join(dir, '_app/immutable');

  chunk(join(imm, 'entry/start.js'), 100);
  // Listed in the HTML. Statically imports `deep.js`, which the HTML does NOT
  // list — the browser still has to fetch it before hydrating. Also *dynamically*
  // imports the 500 kB chunk, which it does not.
  chunk(
    join(imm, 'chunks/shared.js'),
    200,
    'import"./deep.js";import("./lazy-skin.js");//'
  );
  chunk(join(imm, 'chunks/deep.js'), 700);
  chunk(join(imm, 'chunks/lazy-skin.js'), 500_000);

  // A cycle: the walker must terminate and charge each file once.
  chunk(join(imm, 'chunks/ring-a.js'), 300, 'import"./ring-b.js";//');
  chunk(join(imm, 'chunks/ring-b.js'), 400, 'import"./ring-a.js";//');

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
    `<html><head><link href="/_app/immutable/chunks/ring-a.js" rel="modulepreload"></head></html>`
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the static import closure', () => {
  it('charges a statically imported chunk the HTML never mentions', () => {
    const { worst } = report();
    // start 100 + shared 200 + deep 700 (unlisted, statically imported) = 1000
    expect(worst).toMatchObject({ page: 'index.html', bytes: 1000, modules: 3 });
  });

  it('does NOT charge a dynamically imported chunk', () => {
    // lazy-skin.js is 500 kB and is reachable from shared.js only via import().
    // If the walker treated `import(` as a static import, every row would blow up.
    expect(report().rows.every((r: { bytes: number }) => r.bytes < 500_000)).toBe(true);
  });

  it('terminates on an import cycle and charges each file once', () => {
    const row = report().rows.find((r: { page: string }) => r.page === 'nested/deep.html');
    expect(row).toMatchObject({ bytes: 700, modules: 2 }); // 300 + 400, not 300+400+300…
  });

  it('counts a module named twice in one page only once', () => {
    // index.html names start.js in a preload hint AND in the bootstrap import.
    const row = report().rows.find((r: { page: string }) => r.page === 'light.html');
    expect(row).toMatchObject({ bytes: 100, modules: 1 });
  });

  it('reports the worst page, not the average, and finds nested pages', () => {
    const r = report();
    expect(r.rows.map((x: { page: string }) => x.page).sort()).toEqual([
      'index.html',
      'light.html',
      'nested/deep.html'
    ]);
    expect(r.worst.page).toBe('index.html');
  });
});

describe('the budget gate', () => {
  it('passes when the worst page exactly meets the limit', () => {
    expect(run(['--dir', dir, '--limit', '1000']).code).toBe(0);
  });

  it('fails, and says which page, when the worst page is over', () => {
    const { code, stderr } = run(['--dir', dir, '--limit', '999']);
    expect(code).toBe(1);
    expect(stderr).toContain('index.html');
    expect(stderr).toContain('999');
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
