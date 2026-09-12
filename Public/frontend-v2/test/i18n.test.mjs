import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, localize, T, LANG_KEY, normalizeLang } from '../src/i18n.js';

test('t returns the language-specific string', () => {
  assert.equal(t('en', 'nav_home'), 'Home');
  assert.equal(t('hi', 'nav_home'), 'होम');
});

test('t falls back en -> key for unknown keys and languages', () => {
  assert.equal(t('en', 'totally_missing_key'), 'totally_missing_key');
  assert.equal(t('fr', 'nav_home'), 'Home');
  assert.equal(t('xx', 'login'), 'Login');
});

test('normalizeLang maps unknown values to en and keeps hi', () => {
  assert.equal(normalizeLang('hi'), 'hi');
  assert.equal(normalizeLang('en'), 'en');
  assert.equal(normalizeLang('de'), 'en');
  assert.equal(normalizeLang(undefined), 'en');
});

test('localize prefers the Hindi column when hi is active', () => {
  const row = { Name: 'Ram', 'Name (Hindi)': 'राम' };
  assert.equal(localize(row, 'Name', 'hi'), 'राम');
  assert.equal(localize(row, 'Name', 'en'), 'Ram');
});

test('localize falls back to English when the Hindi column is blank', () => {
  const row = { Village: 'Shaharpura', 'Village (Hindi)': '   ' };
  assert.equal(localize(row, 'Village', 'hi'), 'Shaharpura');
});

test('localize falls back to English when the Hindi column is missing', () => {
  const row = { Village: 'Gardih' };
  assert.equal(localize(row, 'Village', 'hi'), 'Gardih');
});

test('localize returns empty string for a null row', () => {
  assert.equal(localize(null, 'Name', 'hi'), '');
});

test('T dictionary carries both languages', () => {
  assert.ok(T.en && T.hi);
  assert.equal(T.en.app_title, 'Chhath Puja');
  assert.equal(T.hi.app_title, 'छठ पूजा');
});

test('LANG_KEY is the v2-specific storage key', () => {
  assert.equal(LANG_KEY, 'cpm_public_v2_lang');
});
