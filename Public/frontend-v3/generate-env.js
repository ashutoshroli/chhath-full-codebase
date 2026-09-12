// Build-time env-var injection for the public portal.
//
// This is a plain static site (no Vite/webpack/Next), so there is no
// import.meta.env / process.env available in the browser. Instead, this
// script runs at BUILD time (see package.json -> "build"), reads the real
// environment variables (set in Vercel's Project Settings -> Environment
// Variables, or a local .env loaded by your shell), and writes them into a
// small generated env.js that defines window.__ENV__. index.html loads
// env.js BEFORE script.js, so script.js can read window.__ENV__.*.
//
// Every variable name below must also exist in .env.example.
//
// Runs on Node 18+. No dependencies.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const env = {
  // Public Worker API base (was the hardcoded BASE_API_URL in script.js).
  PUBLIC_API_URL:
    process.env.PUBLIC_API_URL || 'https://chhath-public-worker.shaharpura.com/',
  // AI chatbot backend (was the hardcoded CHATBOT_API_URL in script.js).
  PUBLIC_CHATBOT_API_URL:
    process.env.PUBLIC_CHATBOT_API_URL ||
    'https://chhath-server-render.onrender.com/public-chat',
  // Management portal login link (was hardcoded in the Committee tab in index.html).
  PUBLIC_LOGIN_URL:
    process.env.PUBLIC_LOGIN_URL || 'https://mgmt-chhath.shaharpura.com/',
};

const content = `// AUTO-GENERATED at build time by generate-env.js — do not edit by hand,
// and do not commit this file (see .gitignore). Edit the source values via
// environment variables (see .env.example) instead.
window.__ENV__ = ${JSON.stringify(env, null, 2)};
`;

const outPath = fileURLToPath(new URL('./env.js', import.meta.url));
await writeFile(outPath, content, 'utf8');
console.log('[build] Generated env.js from environment variables.');
