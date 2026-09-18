// FEAT-002 — the same-day chatbot lockout regression.
//
// ROOT CAUSE: the per-answer system prompt (whole-portal dump) cost ~28,000 tokens,
// so the old 200,000-token/UTC-day default budget was spent in ~7 answers and every
// visitor then got HTTP 503 until UTC midnight. This suite pins the two levers of the
// fix: (1) the code DEFAULT budget is now large enough that a realistic number of
// (now much smaller ~3-4k-token) answers fit; (2) tokenBudgetExceeded() still trips
// exactly at the configured ceiling, so the safety guard is intact.
//
// IMPORTANT: config values are read at import time. This file deliberately does NOT
// set CHAT_DAILY_TOKEN_BUDGET, so config.chatDailyTokenBudget is the shipped code
// DEFAULT — and assertions are made RELATIVE to config.chatDailyTokenBudget rather
// than a hardcoded literal, so a future env-driven run does not falsely fail.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimum env the config module needs to import cleanly (mirrors the other suites).
process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.DRIVE_OAUTH_CLIENT_ID ||= 'cid';
process.env.DRIVE_OAUTH_CLIENT_SECRET ||= 'csec';
process.env.DRIVE_OAUTH_REFRESH_TOKEN ||= 'rtok';
// NOTE: intentionally NOT setting CHAT_DAILY_TOKEN_BUDGET so we exercise the DEFAULT.

const { tokenBudgetExceeded, recordTokens, _tokensUsed, _resetBudget } =
  await import('../src/lib/chatGuards.js');
const { config } = await import('../src/config.js');

beforeEach(() => { _resetBudget(); });

// A realistic per-answer cost with the compact summary prompt after FEAT-002:
// ~3500-char data prompt + short question + a bounded MAX_ANSWER_TOKENS (512)
// completion ≈ a few thousand tokens. 4000 is a deliberately generous estimate.
const PER_ANSWER_TOKENS = 4000;

describe('daily token budget default', () => {
  test('the shipped default is the raised launch value (2,000,000)', () => {
    // The env var is unset here, so this is the code DEFAULT from config.js.
    assert.equal(config.chatDailyTokenBudget, 2000000);
  });

  test('at least 100 realistic answers (~4000 tokens each) fit under the default budget', () => {
    // 100 answers is a floor; assert it is genuinely comfortable under the default.
    for (let i = 0; i < 100; i++) {
      // Split the cost across prompt+completion, as the real recordTokens call does.
      recordTokens(PER_ANSWER_TOKENS - 512, 512);
      assert.equal(
        tokenBudgetExceeded(),
        false,
        `budget should not be exceeded after ${i + 1} answers (used ${_tokensUsed()} of ${config.chatDailyTokenBudget})`
      );
    }
    // Sanity: 100 * 4000 = 400,000 is well under the default budget.
    assert.ok(_tokensUsed() < config.chatDailyTokenBudget);
  });

  test('the default budget serves far more than the old ~7 answers (500+ at this cost)', () => {
    const affordable = Math.floor(config.chatDailyTokenBudget / PER_ANSWER_TOKENS);
    assert.ok(affordable >= 500, `expected 500+ answers affordable, got ${affordable}`);
  });
});

describe('the budget ceiling still trips (guard intact)', () => {
  test('tokenBudgetExceeded() stays false just below the limit and true at/over it', () => {
    const budget = config.chatDailyTokenBudget;
    // Record right up to one token below the ceiling.
    recordTokens(budget - 1, 0);
    assert.equal(_tokensUsed(), budget - 1);
    assert.equal(tokenBudgetExceeded(), false, 'must not trip one token below the ceiling');

    // Cross the ceiling — cumulative tokensUsed now >= config.chatDailyTokenBudget.
    recordTokens(1, 0);
    assert.equal(_tokensUsed(), budget);
    assert.equal(tokenBudgetExceeded(), true, 'must trip once tokensUsed >= budget');
  });

  test('recording well over the budget keeps it exceeded', () => {
    recordTokens(config.chatDailyTokenBudget * 2, 0);
    assert.equal(tokenBudgetExceeded(), true);
  });
});
