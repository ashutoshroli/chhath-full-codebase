// ============ AI provider `purpose` — fix vs public_chat, per-purpose default ============
//
// A provider is now marked for a purpose: 'fix' (Error Log fixer, the default) or
// 'public_chat' (public chatbot). Each purpose has its OWN default, and
// resolveActiveProvider(purpose) resolves within that purpose. The ANTHROPIC_API_KEY
// safety-net is 'fix'-only — the public chatbot must be configured explicitly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { saveAiProvider, getAiProviders, setDefaultAiProvider, resolveActiveProvider } from '../src/aiConfig.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };

function logsSchemaWithPurpose() {
  const migration = readFileSync(new URL('../../db/migration/2026-09-05/24-ai-providers-purpose.sql', import.meta.url), 'utf8');
  return schemaFor('logs.sql') + '\n' + migration;
}
function makeEnv(extra = {}) {
  return { DB_LOGS: makeD1(logsSchemaWithPurpose()), AI_CONFIG_SECRET: 'a-very-strong-random-secret-value-123456', ...extra };
}
const add = (env, over = {}) => saveAiProvider(env, {
  name: 'P', type: 'openai-compatible', baseUrl: 'https://x.test/v1', model: 'm', apiKey: 'test-key-1234', ...over,
}, SUPER);

test('a new provider defaults to purpose "fix"', async () => {
  const env = makeEnv();
  await add(env);
  const [p] = await getAiProviders(env, SUPER);
  assert.equal(p.purpose, 'fix');
});

test('a provider can be created for public_chat', async () => {
  const env = makeEnv();
  await add(env, { purpose: 'public_chat' });
  const [p] = await getAiProviders(env, SUPER);
  assert.equal(p.purpose, 'public_chat');
});

test('an invalid purpose is rejected', async () => {
  const env = makeEnv();
  await assert.rejects(() => add(env, { purpose: 'nonsense' }), /purpose must be one of/);
});

test('defaults are scoped by purpose — setting one does not disturb the other', async () => {
  const env = makeEnv();
  const fix = await add(env, { purpose: 'fix', name: 'FixProv' });
  const chat = await add(env, { purpose: 'public_chat', name: 'ChatProv' });

  await setDefaultAiProvider(env, fix.providerId, SUPER);
  await setDefaultAiProvider(env, chat.providerId, SUPER);

  const provs = await getAiProviders(env, SUPER);
  const byId = Object.fromEntries(provs.map(p => [p.provider_id, p]));
  assert.equal(byId[fix.providerId].is_default, true, 'fix default set');
  assert.equal(byId[chat.providerId].is_default, true, 'chat default set — NOT cleared by the fix default');
});

test('a second default within the SAME purpose replaces the first', async () => {
  const env = makeEnv();
  const a = await add(env, { purpose: 'public_chat', name: 'ChatA' });
  const b = await add(env, { purpose: 'public_chat', name: 'ChatB' });
  await setDefaultAiProvider(env, a.providerId, SUPER);
  await setDefaultAiProvider(env, b.providerId, SUPER);
  const provs = await getAiProviders(env, SUPER);
  const byId = Object.fromEntries(provs.map(p => [p.provider_id, p]));
  assert.equal(byId[a.providerId].is_default, false, 'A was replaced');
  assert.equal(byId[b.providerId].is_default, true);
});

test('resolveActiveProvider(purpose) resolves within that purpose', async () => {
  const env = makeEnv();
  const chat = await add(env, { purpose: 'public_chat', name: 'ChatProv', model: 'chat-model' });
  await setDefaultAiProvider(env, chat.providerId, SUPER);

  const resolved = await resolveActiveProvider(env, 'public_chat');
  assert.ok(resolved, 'a public_chat default resolves');
  assert.equal(resolved.model, 'chat-model');
  assert.ok(resolved.apiKey, 'the key is decrypted at resolve time');
});

test('public_chat has NO ANTHROPIC_API_KEY fallback (fix does)', async () => {
  const env = makeEnv({ ANTHROPIC_API_KEY: 'sk-fallback' });
  // No providers configured at all.
  const chat = await resolveActiveProvider(env, 'public_chat');
  assert.equal(chat, null, 'public chatbot must be explicitly configured — no silent fallback');
  const fix = await resolveActiveProvider(env, 'fix');
  assert.ok(fix && fix.sourceLabel.includes('ANTHROPIC_API_KEY'), 'fix still falls back to the secret');
});

test('resolveActiveProvider() with no purpose defaults to fix (back-compat)', async () => {
  const env = makeEnv({ ANTHROPIC_API_KEY: 'sk-fallback' });
  const r = await resolveActiveProvider(env);
  assert.ok(r && r.sourceLabel.includes('ANTHROPIC_API_KEY'));
});

test('clearing a purpose default leaves the other purpose untouched', async () => {
  const env = makeEnv();
  const fix = await add(env, { purpose: 'fix', name: 'FixProv' });
  const chat = await add(env, { purpose: 'public_chat', name: 'ChatProv' });
  await setDefaultAiProvider(env, fix.providerId, SUPER);
  await setDefaultAiProvider(env, chat.providerId, SUPER);

  await setDefaultAiProvider(env, '', SUPER, 'fix'); // clear fix default only
  const provs = await getAiProviders(env, SUPER);
  const byId = Object.fromEntries(provs.map(p => [p.provider_id, p]));
  assert.equal(byId[fix.providerId].is_default, false, 'fix default cleared');
  assert.equal(byId[chat.providerId].is_default, true, 'chat default still set');
});
