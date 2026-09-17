/**
 * The skin split, asserted on the import graph (audit PR-45).
 *
 * THE DEFECT THIS PINS DOWN
 * -------------------------
 * `stores/skin.ts` used to statically import `skins/registry.ts`, which
 * statically imported all five skins, each of which had a barrel `index.ts`
 * importing all eight of its pages. Every route imports that store, so all 46
 * skin components were on the critical path of every page. Measured on the
 * build immediately before this PR: 583-603 kB of first-load JS out of 622 kB
 * total — a visitor opening ONE page in ONE skin fetched ~96% of the app.
 *
 * A bundle-size number in CI catches the regression late and blames the wrong
 * thing ("the app got bigger") — so the rule is asserted here, on the source,
 * where the cause is: NOTHING on a route's static import graph may reach a skin
 * component, except the default skin's Shell (from the root layout) and the
 * default skin's version of that one route's page.
 *
 * This walks real static imports rather than trusting a naming convention, so
 * re-introducing a barrel three modules deep fails here too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { DEFAULT_SKIN_ID, THEME_SKIN_ID } from './skinMap';

const SRC = resolve(__dirname, '../..'); // <repo>/src
const ROUTES = join(SRC, 'routes');
const SKINS_DIR = join(SRC, 'lib/skins');

/** route directory (relative to src/routes) → the SkinPages key it must render. */
const SKINNED_ROUTES: Record<string, string> = {
  '.': 'Home',
  expenses: 'Expenses',
  loans: 'Loans',
  committee: 'Committee',
  downloads: 'Downloads',
  decade: 'Decade',
  donate: 'Donate',
  verify: 'Verify'
};

/** Routes that are the same in every skin and render inside the active Shell. */
const SKIN_AGNOSTIC_ROUTES = ['contributors', 'guide', 'privacy', 'terms'];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/**
 * Static import specifiers only. `import('x')` (dynamic) is excluded — that is
 * the whole distinction being measured. `import type ... from 'x'` is excluded
 * too: it is erased at build time and creates no runtime dependency.
 */
function staticSpecifiers(file: string): string[] {
  const source = stripComments(readFileSync(file, 'utf8'));
  const out: string[] = [];
  // `import ... from 'x'` / `export ... from 'x'`, but not `import type ... from`
  for (const m of source.matchAll(
    /(?:^|[\s;}])(import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g
  )) {
    if (/^type[\s{]/.test(m[2].trim())) continue;
    out.push(m[3]);
  }
  // bare side-effect import: `import 'x'`
  for (const m of source.matchAll(/(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

/** Resolve a specifier to a file inside src/, or null if it is external. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('$lib/')) base = join(SRC, 'lib', spec.slice('$lib/'.length));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // svelte, @lucide/svelte, $app/*, virtual:*, zod, node:*
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.svelte`,
    `${base}.js`,
    join(base, 'index.ts')
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file reachable from `entry` by STATIC imports. */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of staticSpecifiers(file)) {
      const target = resolveSpecifier(file, spec);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

/** Skin component files (Shell / pages) inside a graph, as skins-relative paths. */
function skinComponents(graph: Set<string>): string[] {
  return [...graph]
    .filter((f) => f.startsWith(SKINS_DIR) && f.endsWith('.svelte'))
    .map((f) => relative(SKINS_DIR, f))
    .sort();
}

describe('static import graph resolution (the walker itself)', () => {
  it('follows $lib, relative paths and extensionless specifiers', () => {
    const rel = [...staticGraph(join(SRC, 'lib/stores/skin.ts'))].map((f) => relative(SRC, f));
    expect(rel).toContain('lib/skins/skinMap.ts');
    expect(rel).toContain('lib/skins/registry.ts');
    expect(rel).toContain('lib/stores/theme.ts');
  });

  it('does NOT follow dynamic import() — otherwise this whole file proves nothing', () => {
    // registry.ts reaches every lazy skin, but only through import().
    expect(skinComponents(staticGraph(join(SKINS_DIR, 'registry.ts')))).toEqual([]);
  });

  it('DOES follow a real static import of a skin component', () => {
    // The root layout genuinely imports the default Shell; if the walker missed
    // that, every assertion below would pass vacuously.
    expect(skinComponents(staticGraph(join(ROUTES, '+layout.svelte')))).toContain(
      `${DEFAULT_SKIN_ID}/Shell.svelte`
    );
  });
});

describe('nothing but the default skin is on the critical path', () => {
  it('the root layout reaches exactly one skin component: the default Shell', () => {
    expect(skinComponents(staticGraph(join(ROUTES, '+layout.svelte')))).toEqual([
      `${DEFAULT_SKIN_ID}/Shell.svelte`
    ]);
  });

  for (const [dir, pageId] of Object.entries(SKINNED_ROUTES)) {
    it(`/${dir === '.' ? '' : dir} reaches exactly one skin component: the default ${pageId} page`, () => {
      expect(skinComponents(staticGraph(join(ROUTES, dir, '+page.svelte')))).toEqual([
        `${DEFAULT_SKIN_ID}/pages/${pageId}.svelte`
      ]);
    });
  }

  for (const dir of SKIN_AGNOSTIC_ROUTES) {
    it(`/${dir} is skin-agnostic and reaches no skin component at all`, () => {
      expect(skinComponents(staticGraph(join(ROUTES, dir, '+page.svelte')))).toEqual([]);
    });
  }

  it('a whole page load (layout + route) costs two skin components, not forty-six', () => {
    const total = new Set([
      ...skinComponents(staticGraph(join(ROUTES, '+layout.svelte'))),
      ...skinComponents(staticGraph(join(ROUTES, 'expenses/+page.svelte')))
    ]);
    expect([...total].sort()).toEqual([
      `${DEFAULT_SKIN_ID}/Shell.svelte`,
      `${DEFAULT_SKIN_ID}/pages/Expenses.svelte`
    ]);
  });

  it('no non-default skin is statically reachable from anywhere under src/routes', () => {
    const others = new Set<string>(
      Object.values(THEME_SKIN_ID).filter((id) => id !== DEFAULT_SKIN_ID)
    );
    const offenders: string[] = [];
    for (const dir of [...Object.keys(SKINNED_ROUTES), ...SKIN_AGNOSTIC_ROUTES]) {
      for (const entry of ['+page.svelte', '+layout.svelte']) {
        const file = join(ROUTES, dir, entry);
        if (!existsSync(file)) continue;
        for (const comp of skinComponents(staticGraph(file))) {
          if (others.has(comp.split('/')[0])) offenders.push(`${dir}/${entry} -> ${comp}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('route <-> page wiring', () => {
  for (const [dir, pageId] of Object.entries(SKINNED_ROUTES)) {
    it(`/${dir === '.' ? '' : dir} asks for '${pageId}' and falls back to the same page`, () => {
      const source = readFileSync(join(ROUTES, dir, '+page.svelte'), 'utf8');
      // The lazily-resolved page id and the statically imported fallback must be
      // the SAME page, or a theme switch silently changes which page you are on.
      expect(source).toMatch(new RegExp(`skinPage\\(\\s*'${pageId}'`));
      expect(source).toMatch(
        new RegExp(`from\\s*'\\$lib/skins/${DEFAULT_SKIN_ID}/pages/${pageId}\\.svelte'`)
      );
    });
  }

  it('every skinned route is covered and none is missing a route', () => {
    const dirs = readdirSync(ROUTES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROUTES, e.name, '+page.svelte')))
      .map((e) => e.name);
    const known = new Set([...Object.keys(SKINNED_ROUTES), ...SKIN_AGNOSTIC_ROUTES]);
    // A new route must be classified here, otherwise it escapes every rule above.
    expect(dirs.filter((d) => !known.has(d))).toEqual([]);
  });

  it('the layout cross-fade is keyed on the rendered Shell, not the selected skin id', () => {
    // Keying on the id fades the instant the theme changes — while the new skin
    // is still being fetched — so the visitor sees the OLD shell re-enter and
    // then a second swap. The rendered Shell is the honest trigger.
    const layout = stripComments(readFileSync(join(ROUTES, '+layout.svelte'), 'utf8'));
    expect(layout).toContain('{#key Shell}');
    expect(layout).not.toMatch(/\{#key\s+\$activeSkin/);
  });

  it('the default skin has no barrel index.ts', () => {
    // A barrel is exactly how the regression happens: one `index.ts` that imports
    // all eight pages, imported by anything on the critical path, and every route
    // pays for all eight again.
    expect(existsSync(join(SKINS_DIR, DEFAULT_SKIN_ID, 'index.ts'))).toBe(false);
  });
});
