// ============ New-contribution push notification: display name ============
//
// A COLLECTIONS row's `Name` field stores a `USER####` id CODE, not a display
// name (see tableRegistry.js). The new-contribution web-push body used to print
// that raw code ("by USER0001"). composeNewContributionBody now resolves the
// code to the contributor's display name via userByIdCode (USERS live in
// env.DB_CORE), falling back to the raw value only when it cannot be resolved.
//
// broadcast() no-ops unless VAPID keys are configured (tests never set them), so
// these tests assert on the composed body helper directly. They are prove-first:
// they FAIL if push.js reverts to using the raw payload.Name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { composeNewContributionBody } from '../src/push.js';

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  // A contributor whose id code resolves to a display name.
  core.prepare('INSERT INTO users (id_code, name) VALUES (?,?)')
    .bind('USER0001', 'Ashutosh Chandan').run();
  return { DB_CORE: core };
}

// (a) an id code that resolves -> body uses the display name, NOT the raw code.
test('resolves USER#### id code to the display name for a money contribution', async () => {
  const env = makeEnv();
  const body = await composeNewContributionBody(env, { Name: 'USER0001', Amount: 956 });
  assert.ok(body.includes('by Ashutosh Chandan'), `expected resolved name in: ${body}`);
  assert.ok(!body.includes('USER0001'), `raw id code must not leak into: ${body}`);
  assert.equal(body, 'Naya contribution mila: \u20B9956 by Ashutosh Chandan');
});

// (b) an id code that does NOT resolve -> gracefully falls back to the raw value.
test('falls back to the raw value when the id code does not resolve', async () => {
  const env = makeEnv();
  const body = await composeNewContributionBody(env, { Name: 'USER9999', Amount: 501 });
  assert.ok(body.includes('by USER9999'), `expected raw-value fallback in: ${body}`);
  assert.equal(body, 'Naya contribution mila: \u20B9501 by USER9999');
});

// (c) a no-amount material/service row -> resolved name, no ₹ amount.
test('no-amount material row appends the resolved name without an amount', async () => {
  const env = makeEnv();
  const body = await composeNewContributionBody(env, { Name: 'USER0001', Amount: 0 });
  assert.equal(body, 'Naya contribution mila: Ashutosh Chandan');
  assert.ok(!body.includes('\u20B9'), 'no rupee amount for a material row');
  assert.ok(!body.includes('USER0001'), 'raw id code must not leak');
});

// (d) a blank-name / resell row keeps the neutral wording — no " by ", no name.
test('blank-name (resell/material) row keeps neutral wording with no " by "', async () => {
  const env = makeEnv();
  const withAmount = await composeNewContributionBody(env, { Name: '', Amount: 300 });
  assert.equal(withAmount, 'Naya contribution mila: \u20B9300');
  assert.ok(!withAmount.includes(' by '), 'no trailing " by " when the name is blank');

  const noAmount = await composeNewContributionBody(env, { Name: '', Amount: 0 });
  assert.equal(noAmount, 'Naya contribution mila');
});
