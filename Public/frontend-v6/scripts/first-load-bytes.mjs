#!/usr/bin/env node
/**
 * First-load JavaScript budget (audit PR-45).
 *
 * WHY THIS EXISTS, ON TOP OF THE TOTAL-BYTES BUDGET
 * -------------------------------------------------
 * CI already bounds the TOTAL client JS in `build/_app/immutable`. That number
 * answers "is the app growing?" but it cannot answer "what does a visitor pay
 * to open one page?" — and those two questions come apart badly in a
 * skin-based app. Before PR-45 the total was 622 kB and *every single page*
 * pulled 583-603 kB of it on first load, because the skin registry statically
 * imported all five skins (and each skin's barrel imported all eight of its
 * pages). SvelteKit was splitting per route exactly as designed; a barrel
 * import upstream of the route made the split worthless.
 *
 * WHAT IS MEASURED
 * ----------------
 * Every prerendered .html file in `build/` names, in `<link rel="modulepreload">`
 * tags and in its SvelteKit bootstrap, precisely the modules the browser must
 * fetch before it can hydrate that page. Dynamically imported chunks are NOT in
 * that list — which is the point: this metric only counts what is on the
 * critical path. Sum the unique referenced files, per page, and report the
 * worst page.
 *
 * Usage:
 *   node scripts/first-load-bytes.mjs [--dir build] [--limit BYTES] [--json]
 *
 * Exits 1 if the worst page is over --limit (when given).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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

const rows = [];
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const refs = new Set(html.match(REF) ?? []);
  let bytes = 0;
  const missing = [];
  for (const ref of refs) {
    const file = join(dir, ref);
    if (existsSync(file) && statSync(file).isFile()) bytes += statSync(file).size;
    else missing.push(ref);
  }
  if (missing.length) {
    // A reference the build did not emit means the metric is lying about this
    // page, so fail loudly rather than silently under-count. Scoring it as 0
    // would make a build that stopped emitting chunks look like a huge win.
    console.error(`first-load-bytes: ${page} references missing files: ${missing.join(', ')}`);
    process.exit(1);
  }
  rows.push({ page: relative(dir, page), modules: refs.size, bytes });
}

rows.sort((a, b) => b.bytes - a.bytes);
const worst = rows[0];

if (asJson) {
  console.log(JSON.stringify({ worst, rows }, null, 2));
} else {
  for (const r of rows) {
    console.log(`${String(r.bytes).padStart(8)}  ${String(r.modules).padStart(3)} modules  ${r.page}`);
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
