import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, DEFAULTS, apiBase, renderChatUrl, mgmtLoginUrl, siteUrl } from '../src/config.js';

test('resolveConfig applies production fallbacks when env is empty', () => {
  const cfg = resolveConfig({});
  assert.equal(cfg.apiBase, DEFAULTS.PUBLIC_API_BASE);
  assert.equal(cfg.renderChatUrl, DEFAULTS.PUBLIC_RENDER_CHAT_URL);
  assert.equal(cfg.mgmtLoginUrl, DEFAULTS.PUBLIC_MGMT_LOGIN_URL);
  assert.equal(cfg.siteUrl, DEFAULTS.PUBLIC_SITE_URL);
});

test('resolveConfig applies fallbacks when env is undefined/null', () => {
  assert.equal(resolveConfig(undefined).apiBase, DEFAULTS.PUBLIC_API_BASE);
  assert.equal(resolveConfig(null).siteUrl, DEFAULTS.PUBLIC_SITE_URL);
});

test('resolveConfig honors provided PUBLIC_* values', () => {
  const cfg = resolveConfig({
    PUBLIC_API_BASE: 'https://staging-worker.example.com',
    PUBLIC_RENDER_CHAT_URL: 'https://staging-chat.example.com/public-chat',
    PUBLIC_MGMT_LOGIN_URL: 'https://staging-mgmt.example.com/',
    PUBLIC_SITE_URL: 'https://staging.example.com',
  });
  assert.equal(cfg.apiBase, 'https://staging-worker.example.com');
  assert.equal(cfg.renderChatUrl, 'https://staging-chat.example.com/public-chat');
  assert.equal(cfg.mgmtLoginUrl, 'https://staging-mgmt.example.com/');
  assert.equal(cfg.siteUrl, 'https://staging.example.com');
});

test('resolveConfig treats blank/whitespace values as unset', () => {
  const cfg = resolveConfig({ PUBLIC_API_BASE: '', PUBLIC_SITE_URL: '   ' });
  assert.equal(cfg.apiBase, DEFAULTS.PUBLIC_API_BASE);
  assert.equal(cfg.siteUrl, DEFAULTS.PUBLIC_SITE_URL);
});

test('resolveConfig coerces non-string values to strings', () => {
  const cfg = resolveConfig({ PUBLIC_API_BASE: 12345 });
  assert.equal(cfg.apiBase, '12345');
});

test('module-level named exports resolve to the production defaults under node:test', () => {
  assert.equal(apiBase, DEFAULTS.PUBLIC_API_BASE);
  assert.equal(renderChatUrl, DEFAULTS.PUBLIC_RENDER_CHAT_URL);
  assert.equal(mgmtLoginUrl, DEFAULTS.PUBLIC_MGMT_LOGIN_URL);
  assert.equal(siteUrl, DEFAULTS.PUBLIC_SITE_URL);
});
