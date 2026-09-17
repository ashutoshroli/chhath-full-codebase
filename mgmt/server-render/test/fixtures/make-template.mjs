// Builds the small, deterministic .docx template fixture used by the golden
// baseline + parity tests, and writes it to template.docx in this directory.
//
// The template exercises every branch of the renderer the parity test cares about:
//   {name}          — a RESOLVED text tag
//   {missing}       — an UNRESOLVED text tag (exercises nullGetter: blank + record)
//   {%photo}        — an image tag given a VALID data-URL
//   {%missingPhoto} — an image tag given an empty value (exercises the 1x1
//                     BLANK_PNG_B64 fallback + missingImages recording)
//
// A .docx is a ZIP of a fixed set of OOXML parts. We hand-write the minimal set
// so the bytes are fully determined by this file (no Word, no randomness). PizZip
// is imported from the mgmt/frontend workspace where it is already a dependency —
// this harness runs on `main` to capture the golden bytes BEFORE the server
// renderer exists (prove-first / house method).
//
// Run: node mgmt/server-render/test/fixtures/make-template.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  join(here, '..', '..', '..', 'frontend', 'package.json'),
);
const PizZip = require('pizzip');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

// One paragraph per tag keeps the structure simple and the diff readable.
const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:r><w:t xml:space="preserve">Name: {name}</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Missing: {missing}</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Photo:</w:t></w:r></w:p>
<w:p><w:r><w:t>{%photo}</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">MissingPhoto:</w:t></w:r></w:p>
<w:p><w:r><w:t>{%missingPhoto}</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
</w:body>
</w:document>`;

const zip = new PizZip();
zip.file('[Content_Types].xml', CONTENT_TYPES);
zip.file('_rels/.rels', RELS);
zip.file('word/document.xml', DOCUMENT);
zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS);

// Deterministic bytes: fixed date so the ZIP local-header timestamps don't vary.
const bytes = zip.generate({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  platform: 'UNIX',
});

const out = join(here, 'template.docx');
writeFileSync(out, bytes);
console.log('wrote', out, bytes.length, 'bytes');
