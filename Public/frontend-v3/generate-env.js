
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const env = {
  PUBLIC_API_URL:
    process.env.PUBLIC_API_URL || 'https://chhath-public-worker.shaharpura.com/',
  PUBLIC_CHATBOT_API_URL:
    process.env.PUBLIC_CHATBOT_API_URL ||
    'https://chhath-server-render.onrender.com/public-chat',
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
