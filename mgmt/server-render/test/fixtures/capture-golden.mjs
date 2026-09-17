// Prove-first / golden baseline (house method step 2). Runs the EXISTING browser
// renderer — mgmt/frontend/src/docxFill.js, byte-identical to the Svelte copy —
// in Node against template.docx + data.mjs, and commits its output as the golden
// fixtures the ported server renderer is proven against:
//
//   golden.docx.b64   the filled .docx bytes (base64), one line
//   golden.report.json { missingTags, missingImages }
//
// docxFill.js is a browser module: it uses the global `atob` (present in Node 22)
// and imports docxtemplater/pizzip/docxtemplater-image-module-free, which are
// mgmt/frontend deps. We therefore load it and its deps from the frontend
// workspace. This harness is committed (not throwaway) so the baseline is
// reproducible and the parity claim is auditable.
//
// Run on `main` (or any tree where docxFill.js is unchanged), from repo root:
//   node mgmt/server-render/test/fixtures/capture-golden.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const frontendRenderer = join(repoRoot, 'mgmt', 'frontend', 'src', 'docxFill.js');

// Import the browser renderer + its report singleton by absolute URL.
const { fillDocxTemplateFromBase64, getLastRenderReport } = await import(
  pathToFileURL(frontendRenderer).href
);

const { DATA } = await import(pathToFileURL(join(here, 'data.mjs')).href);

const templateBase64 = readFileSync(join(here, 'template.docx')).toString('base64');

const filledBase64 = fillDocxTemplateFromBase64(templateBase64, DATA);
const report = getLastRenderReport();

writeFileSync(join(here, 'golden.docx.b64'), filledBase64);
writeFileSync(
  join(here, 'golden.report.json'),
  JSON.stringify(report, null, 2) + '\n',
);

console.log('golden.docx.b64:', filledBase64.length, 'base64 chars');
console.log('golden.report.json:', JSON.stringify(report));
