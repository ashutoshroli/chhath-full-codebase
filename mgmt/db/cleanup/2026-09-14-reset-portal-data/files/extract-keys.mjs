/**
 * STEP 3b — turn the exported URLs into a delete list.
 *
 *   node mgmt/db/cleanup/2026-09-14-reset-portal-data/files/extract-keys.mjs
 *
 * Splits every stored URL into:
 *   out/r2-keys.txt      object keys in the chhath-files R2 bucket -> deletable
 *                        with wrangler (see delete-r2-objects.sh)
 *   out/drive-links.txt  files that were archived to Google Drive. wrangler
 *                        cannot touch these; delete them from the Drive UI.
 *   out/unknown.txt      anything that matched neither, for you to eyeball.
 *
 * KEEP-LIST: keys under seo/ and donation/ are never emitted, and neither is
 * users/USER0001_*. Those objects belong to configuration that survives the
 * reset (the social preview image, the donation QR referenced by
 * portal_settings, and the kept member's photo), so deleting them would leave
 * the portal pointing at 404s.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const R2_PUBLIC_BASE = 'https://files-chhath.shaharpura.com';
const KEEP_PREFIXES = ['seo/', 'donation/'];
const KEEP_MATCH = [/^users\/USER0001_/];

if (!existsSync(OUT)) {
  console.error(`No ${OUT} directory. Run files/export-file-urls.sh first.`);
  process.exit(1);
}

const urls = new Set();
for (const f of readdirSync(OUT).filter((f) => f.endsWith('.json'))) {
  const raw = readFileSync(join(OUT, f), 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    console.error(`  ! ${f} is not JSON — skipped (did wrangler error?)`);
    continue;
  }
  // wrangler --json returns [{ results: [...], success, meta }]
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  let n = 0;
  for (const b of blocks) {
    for (const row of (b && b.results) || []) {
      const u = row && (row.url ?? Object.values(row)[0]);
      if (typeof u === 'string' && u.trim()) { urls.add(u.trim()); n++; }
    }
  }
  console.log(`  ${f}: ${n} url(s)`);
}

const r2 = new Set(), drive = new Set(), unknown = new Set();
let kept = 0;

for (const u of urls) {
  if (u.startsWith(R2_PUBLIC_BASE)) {
    const key = u.slice(R2_PUBLIC_BASE.length).replace(/^\/+/, '').split('?')[0];
    if (!key) { unknown.add(u); continue; }
    if (KEEP_PREFIXES.some((p) => key.startsWith(p)) || KEEP_MATCH.some((re) => re.test(key))) {
      kept++;
      continue;
    }
    r2.add(decodeURIComponent(key));
  } else if (/googleusercontent\.com|drive\.google\.com/.test(u)) {
    drive.add(u);
  } else {
    unknown.add(u);
  }
}

const write = (name, set) => {
  writeFileSync(join(OUT, name), [...set].sort().join('\n') + (set.size ? '\n' : ''));
  return set.size;
};

console.log('');
console.log(`  R2 objects to delete : ${write('r2-keys.txt', r2)}   -> out/r2-keys.txt`);
console.log(`  Drive files (manual) : ${write('drive-links.txt', drive)}   -> out/drive-links.txt`);
console.log(`  Unrecognised         : ${write('unknown.txt', unknown)}   -> out/unknown.txt`);
console.log(`  On the keep-list     : ${kept} (seo/, donation/, users/USER0001_*)`);
console.log('');
if (unknown.size) console.log('  Review out/unknown.txt before deleting anything.');
console.log('  Next: bash files/delete-r2-objects.sh   (after the SQL steps)');
