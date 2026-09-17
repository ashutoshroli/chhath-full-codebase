/**
 * Why the retained React app is not upgraded past react-router 6 (audit PR-47).
 *
 * `react-router` 6.0.0 – 7.17.x carries two advisories:
 *
 *   GHSA-wrjc-x8rr-h8h6  Open redirect via a backslash in `<Link>` / `useNavigate`
 *                        (a bypass of CVE-2025-68470).  Vulnerable: >=6.0.0 <7.18.0
 *   GHSA-337j-9hxr-rhxg  Arbitrary constructor injection via `deserializeErrors()`
 *                        during SSR hydration.        Vulnerable: >=6.4.0 <7.18.0
 *
 * `react-router-dom@6.30.6` is the LAST 6.x release and is still in both ranges, so
 * there is no fix inside v6. The only upgrade npm offers is 7.18.4 — a major version
 * of the router, in the app that IS the live management portal, which has no tests at
 * all (carry-over C2). Doing that blind, with no way to open a browser against a
 * preview (C17), would be trading a pair of advisories that this app cannot reach for
 * a real chance of breaking admin navigation.
 *
 * It cannot reach them because of HOW it uses the router, and that is the fragile
 * part — "we don't call those functions" is only true until someone calls them. So it
 * is asserted here instead of written in a comment nobody reads:
 *
 *   - the open redirect needs `<Link>` or `useNavigate`. The app uses neither.
 *   - `deserializeErrors` only runs in the data router's hydration path
 *     (`createBrowserRouter` + `RouterProvider`). The app uses plain `BrowserRouter`
 *     with `<Routes>`/`<Route>` elements, no loaders, and no SSR at all.
 *
 * If any of that changes, this test fails and names the advisory — at which point the
 * v7 upgrade stops being optional. The guard switches itself off once the app is on a
 * fixed version, so it cannot become a reason to stay behind.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REACT_APP = resolve(__dirname, '../../../frontend');
const SRC = join(REACT_APP, 'src');

/** Lowest react-router version that fixes both advisories. */
const FIXED_FROM = [7, 18, 0];

function declaredRouterRange(): string {
  const pkg = JSON.parse(readFileSync(join(REACT_APP, 'package.json'), 'utf8'));
  return (pkg.dependencies ?? {})['react-router-dom'] ?? '';
}

/** The lowest version the declared range can resolve to, as [major, minor, patch]. */
function floorOf(range: string): [number, number, number] {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (!m) throw new Error(`cannot read a version out of "${range}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isBelowFixed(range: string): boolean {
  const v = floorOf(range);
  for (let i = 0; i < 3; i++) {
    if (v[i] !== FIXED_FROM[i]) return v[i] < FIXED_FROM[i];
  }
  return false;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.(jsx?|tsx?)$/.test(p)) out.push(p);
  }
  return out;
}

/** Source with comments and string literals removed, so a mention is not a use. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const files = existsSync(SRC) ? sourceFiles(SRC) : [];

describe('the retained React app cannot reach the react-router advisories', () => {
  it('the app is present and does use react-router (otherwise this file proves nothing)', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => code(f).includes('react-router-dom'))).toBe(true);
  });

  it('the version comparison itself works', () => {
    // Without this, a broken `isBelowFixed` would make both guards below pass
    // vacuously and the file would assert nothing at all.
    expect(isBelowFixed('^6.30.6')).toBe(true);
    expect(isBelowFixed('6.4.0')).toBe(true);
    expect(isBelowFixed('~7.17.9')).toBe(true);
    expect(isBelowFixed('^7.18.0')).toBe(false);
    expect(isBelowFixed('7.18.4')).toBe(false);
    expect(isBelowFixed('^8.0.0')).toBe(false);
  });

  it('is still on a version where this reasoning is needed', () => {
    const range = declaredRouterRange();
    expect(range, 'react-router-dom missing from mgmt/frontend dependencies').not.toBe('');
    // Deliberately fails the day someone upgrades: this whole file exists only to
    // justify staying on 6.x, so the upgrade should DELETE it, not leave it running
    // and quietly passing. Failing here is how that gets noticed.
    expect(
      isBelowFixed(range),
      `react-router-dom is now "${range}", which is at or past the fixed 7.18.0. ` +
        'The advisories no longer apply — delete this file and the note in AUDIT_FIX_PROGRESS.md.'
    ).toBe(true);
  });

  it('uses neither <Link> nor useNavigate (GHSA-wrjc-x8rr-h8h6, open redirect)', () => {
    if (!isBelowFixed(declaredRouterRange())) return; // fixed version: guard retires
    const offenders: string[] = [];
    for (const f of files) {
      const src = code(f);
      if (/\buseNavigate\b/.test(src)) offenders.push(`${f}: useNavigate`);
      if (/<\s*(Link|NavLink)[\s/>]/.test(src)) offenders.push(`${f}: <Link>`);
    }
    expect(
      offenders,
      'react-router 6.x has an unpatched open redirect through these APIs. Either upgrade ' +
        'react-router-dom to >=7.18.0, or do not navigate to a path that came from outside ' +
        'the app.'
    ).toEqual([]);
  });

  it('uses no data router, so deserializeErrors never runs (GHSA-337j-9hxr-rhxg)', () => {
    if (!isBelowFixed(declaredRouterRange())) return;
    const offenders: string[] = [];
    for (const f of files) {
      const src = code(f);
      for (const api of [
        'createBrowserRouter',
        'createHashRouter',
        'createMemoryRouter',
        'RouterProvider',
        'StaticRouterProvider',
        'hydrationData'
      ]) {
        if (new RegExp(`\\b${api}\\b`).test(src)) offenders.push(`${f}: ${api}`);
      }
    }
    expect(
      offenders,
      'That advisory is reachable only through the data router hydration path. Adopting it ' +
        'on react-router 6.x means taking the vulnerability with it — upgrade to >=7.18.0 first.'
    ).toEqual([]);
  });
});
