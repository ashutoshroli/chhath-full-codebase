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
import { saveAiProvider, getAiProviders, setDefaultAiProvider, resolveActiveProvider, resolveProviderChain, reorderAiProviders } from '../src/aiConfig.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };

function logsSchemaWithPurpose() {
  const m24 = readFileSync(new URL('../../db/migration/2026-09-05/24-ai-providers-purpose.sql', import.meta.url), 'utf8');
  const m25 = readFileSync(new URL('../../db/migration/2026-09-05/25-ai-providers-priority.sql', import.meta.url), 'utf8');
  return schemaFor('logs.sql') + '\n' + m24 + '\n' + m25;
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

// ---- Fallback CHAIN by priority (multiple providers per purpose) ----

test('resolveProviderChain returns a purpose\'s providers in priority order', async () => {
  const env = makeEnv();
  const a = await add(env, { purpose: 'public_chat', name: 'Groq', model: 'groq-m' });
  const b = await add(env, { purpose: 'public_chat', name: 'NVIDIA', model: 'nv-m' });
  const c = await add(env, { purpose: 'public_chat', name: 'OpenRouter', model: 'or-m' });
  // Newly added -> appended, so insertion order is the default priority order.
  const chain = await resolveProviderChain(env, 'public_chat');
  assert.deepEqual(chain.map(p => p.model), ['groq-m', 'nv-m', 'or-m']);

  // Reorder: put OpenRouter first, then Groq, then NVIDIA.
  await reorderAiProviders(env, 'public_chat', [c.providerId, a.providerId, b.providerId], SUPER);
  const chain2 = await resolveProviderChain(env, 'public_chat');
  assert.deepEqual(chain2.map(p => p.model), ['or-m', 'groq-m', 'nv-m']);
});

test('resolveActiveProvider returns the FIRST of the chain (back-compat)', async () => {
  const env = makeEnv();
  const a = await add(env, { purpose: 'public_chat', name: 'First', model: 'first-m' });
  const b = await add(env, { purpose: 'public_chat', name: 'Second', model: 'second-m' });
  await reorderAiProviders(env, 'public_chat', [b.providerId, a.providerId], SUPER);
  const primary = await resolveActiveProvider(env, 'public_chat');
  assert.equal(primary.model, 'second-m', 'primary = priority-first');
});

test('the fix chain appends the ANTHROPIC secret as the LAST resort; public_chat does not', async () => {
  const env = makeEnv({ ANTHROPIC_API_KEY: 'sk-fallback' });
  await add(env, { purpose: 'fix', name: 'FixA', model: 'fix-a' });
  const fixChain = await resolveProviderChain(env, 'fix');
  assert.equal(fixChain[0].model, 'fix-a');
  assert.ok(fixChain[fixChain.length - 1].sourceLabel.includes('ANTHROPIC_API_KEY'), 'fix chain ends with the secret');

  const chatChain = await resolveProviderChain(env, 'public_chat');
  assert.equal(chatChain.length, 0, 'public_chat has no providers and NO secret fallback');
});

test('a decrypt-failure provider is skipped but the chain continues', async () => {
  const env = makeEnv();
  const good = await add(env, { purpose: 'public_chat', name: 'Good', model: 'good-m' });
  // Corrupt one provider's stored key so decrypt throws.
  env.DB_LOGS.prepare("UPDATE ai_providers SET api_key_enc='v1:bad:bad' WHERE provider_id=?").bind(good.providerId).run();
  const also = await add(env, { purpose: 'public_chat', name: 'AlsoGood', model: 'also-m' });
  await reorderAiProviders(env, 'public_chat', [good.providerId, also.providerId], SUPER);
  const chain = await resolveProviderChain(env, 'public_chat');
  // The corrupt one is skipped; the good one remains.
  assert.deepEqual(chain.map(p => p.model), ['also-m']);
});

test('reorder only affects the given purpose', async () => {
  const env = makeEnv();
  const f = await add(env, { purpose: 'fix', name: 'FixOnly', model: 'fix-only' });
  const c = await add(env, { purpose: 'public_chat', name: 'ChatOnly', model: 'chat-only' });
  await reorderAiProviders(env, 'public_chat', [c.providerId], SUPER);
  const fixChain = await resolveProviderChain(env, 'fix');
  assert.equal(fixChain[0].model, 'fix-only');
  void f;
});

test('reorder is Superadmin-only and needs a non-empty list', async () => {
  const env = makeEnv();
  const c = await add(env, { purpose: 'public_chat', name: 'C', model: 'm' });
  await assert.rejects(() => reorderAiProviders(env, 'public_chat', [c.providerId], { name: 'x', role: 'Admin' }), /Superadmin/);
  await assert.rejects(() => reorderAiProviders(env, 'public_chat', [], SUPER), /orderedIds/);
});
