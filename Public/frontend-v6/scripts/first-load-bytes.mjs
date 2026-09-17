#!/usr/bin/env node
/**
 * First-load JavaScript budget (audit PR-45; the metric corrected here).
 *
 * WHY THIS EXISTS, ON TOP OF THE TOTAL-BYTES BUDGET
 * -------------------------------------------------
 * CI already bounds the TOTAL client JS in `build/_app/immutable`. That number
 * answers "is the app growing?" but it cannot answer "what does a visitor pay
 * to open one page?" — and those two questions came apart badly in this app.
 * Before PR-45 the total was 622 kB and *every single page* pulled ~583 kB of it
 * on first load, because the skin registry statically imported all five skins
 * (and each skin's barrel imported all eight of its pages). SvelteKit was
 * splitting per route exactly as designed; a barrel import upstream of the route
 * made the split worthless.
 *
 * WHAT IS MEASURED
 * ----------------
 * Each prerendered .html file names some modules — in `<link rel="modulepreload">`
 * tags and in its SvelteKit bootstrap. Those are the ENTRY POINTS. The browser then
 * has to fetch everything they `import` statically, transitively, before the page
 * can hydrate, whether or not the bundler bothered to preload-hint it. So the number
 * reported is the transitive **static** import closure of the modules the HTML names.
 * Dynamically imported chunks (`import(...)`) are excluded, which is the whole point:
 * they are not on the critical path.
 *
 * WHY THE CLOSURE, AND NOT JUST THE HTML LIST
 * -------------------------------------------
 * The first version of this script summed only what the HTML listed, assuming the
 * bundler preload-hints the entire critical path. No bundler guarantees that, and
 * it is not stable across bundlers: measured on this app, the HTML list misses
 * **810 bytes** under vite 5 (rollup) and **11,109 bytes** under vite 8 (rolldown),
 * which emits fewer hints for a flatter chunk graph. A metric that moves when the
 * bundler changes its hinting strategy cannot be used to compare two builds — it
 * credited a toolchain upgrade with a 24 kB win when the real figure was 14 kB.
 * Following the imports is bundler-independent.
 *
 * Usage:
 *   node scripts/first-load-bytes.mjs [--dir build] [--limit BYTES] [--json]
 *
 * Exits 1 if the worst page is over --limit (when given).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const dir = arg('--dir', 'build');
const limitRaw = arg('--limit', null);
const limit = limitRaw === null ? null : Number(limitRaw);
const asJson = process.argv.includes('--json');

/** Recursively list files under `root` matching `test`. */
function walk(root, test, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

if (!existsSync(dir)) {
  console.error(`first-load-bytes: ${dir}/ does not exist — run the build first.`);
  process.exit(1);
}

const pages = walk(dir, (p) => p.endsWith('.html')).sort();
if (pages.length === 0) {
  console.error(`first-load-bytes: no .html files under ${dir}/ — run the build first.`);
  process.exit(1);
}

// `_app/immutable/...` references, however they are quoted in the HTML.
const REF = /_app\/immutable\/[A-Za-z0-9_./-]+\.js/g;

/**
 * Static import specifiers in a built chunk.
 *
 * `import x from"./a.js"`, `import{x}from"./a.js"` and `import"./a.js"` all match;
 * `import("./a.js")` deliberately does not — the `(` sits between the keyword and
 * the quote. That one character is the entire static/dynamic distinction in built
 * output, so a test asserts a 500 kB dynamically-imported chunk stays uncounted.
 */
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["'](\.[^"']+\.js)["']/g;

const depCache = new Map();
function staticDeps(file) {
  let deps = depCache.get(file);
  if (!deps) {
    deps = new Set();
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const target = resolve(dirname(file), m[1]);
      if (existsSync(target) && statSync(target).isFile()) deps.add(target);
    }
    depCache.set(file, deps);
  }
  return deps;
}

const rows = [];
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const refs = new Set(html.match(REF) ?? []);
  const missing = [];
  const entries = [];
  for (const ref of refs) {
    const file = join(dir, ref);
    if (existsSync(file) && statSync(file).isFile()) entries.push(resolve(file));
    else missing.push(ref);
  }
  if (missing.length) {
    // A reference the build did not emit means the metric is lying about this
    // page, so fail loudly rather than silently under-count. Scoring it as 0
    // would make a build that stopped emitting chunks look like a huge win.
    console.error(`first-load-bytes: ${page} references missing files: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Walk the static import graph out from those entry points. `reached` doubles
  // as the visited set, so an import cycle terminates and each file is charged once.
  const reached = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    for (const dep of staticDeps(file)) if (!reached.has(dep)) queue.push(dep);
  }

  let bytes = 0;
  for (const file of reached) bytes += statSync(file).size;
  rows.push({ page: relative(dir, page), modules: reached.size, bytes });
}

rows.sort((a, b) => b.bytes - a.bytes);
const worst = rows[0];

if (asJson) {
  console.log(JSON.stringify({ worst, rows }, null, 2));
} else {
  for (const r of rows) {
    console.log(
      `${String(r.bytes).padStart(8)}  ${String(r.modules).padStart(3)} modules  ${r.page}`
    );
  }
  const kb = (worst.bytes / 1000).toFixed(1);
  console.log(`\nworst first load: ${kb} kB (${worst.bytes} bytes) — ${worst.page}`);
}

if (limit !== null && worst.bytes > limit) {
  console.error(
    `::error::first-load JS for ${worst.page} is ${worst.bytes} bytes, over the ${limit} byte budget.`
  );
  console.error(
    'Something on the critical path is importing what should be lazy — check for a barrel ' +
      'import (e.g. a skin index) reachable from a route or the root layout.'
  );
  process.exit(1);
}
