// ====== PR-44 — a notification cannot send you off-site, and the notice says what happens ======
//
// A push payload is `{ title, body, url, tag }` and the `url` decides where a click goes. Two
// places acted on it and NEITHER confined it to this site:
//
//  * `static/push-sw.js` (`notificationclick`) passed it straight to `client.navigate(target)`
//    and `clients.openWindow(target)` with NO check at all. A service worker navigates to
//    whatever it is handed, so a payload carrying another origin takes the visitor off-site from
//    inside the installed portal — the surface where their guard is lowest.
//
//  * `NotificationsView.svelte` had a check under the comment
//        "Only allow same-origin/relative targets from the payload."
//    over code that called `safeUrl()` — which only requires `^https?://`. It rejected
//    `javascript:` and accepted EVERY cross-origin https URL. The comment stated the intent and
//    the code did something else, which is worse than no comment because it stops anyone looking
//    again. That one is the more interesting defect: it looked handled.
//
// The payload comes from mgmt's own push.js today, so this is defence in depth rather than a live
// exploit. "The sender is trusted" is not something the receiving end can verify, and this is a
// service worker: it will navigate anywhere.
//
// Separately: the privacy notice was three paragraphs — "what we show" and "data & caching" — on a
// portal that runs an AI assistant, push notifications, an on-device notification inbox, a
// service-worker cache and third-party fonts. None of those were mentioned.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sameOriginPath } from './pushTarget.js';

const ORIGIN = 'https://chhath.shaharpura.com';

describe('PR-44: a notification target is confined to this site', () => {
  it('keeps a plain path', () => {
    expect(sameOriginPath('/expenses', ORIGIN)).toBe('/expenses');
    expect(sameOriginPath('/decade?year=2024', ORIGIN)).toBe('/decade?year=2024');
    expect(sameOriginPath('/guide#install', ORIGIN)).toBe('/guide#install');
  });

  it('rejects another origin', () => {
    // THE case. `client.navigate()` would have gone there.
    expect(sameOriginPath('https://evil.example/pay', ORIGIN)).toBe('/');
    expect(sameOriginPath('http://evil.example', ORIGIN)).toBe('/');
  });

  it('rejects a protocol-relative URL, which LOOKS like a path', () => {
    // `//evil.example` starts with '/', so a `startsWith('/')` check waves it straight through —
    // and it is cross-origin. This is the one a hand-rolled check almost always misses.
    expect(sameOriginPath('//evil.example/pay', ORIGIN)).toBe('/');
    expect(sameOriginPath('//evil.example', ORIGIN)).toBe('/');
  });

  it('rejects a scheme that is not http(s)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'chhath://open',
    ]) {
      expect(sameOriginPath(bad, ORIGIN), bad).toBe('/');
    }
  });

  it('accepts an absolute URL on OUR origin, reduced to a path', () => {
    // Never returns an absolute URL, so a caller cannot navigate off-site with the result even by
    // accident.
    expect(sameOriginPath(`${ORIGIN}/loans`, ORIGIN)).toBe('/loans');
    expect(sameOriginPath(`${ORIGIN}/`, ORIGIN)).toBe('/');
  });

  it('a lookalike host is not our origin', () => {
    expect(sameOriginPath('https://chhath.shaharpura.com.evil.example/x', ORIGIN)).toBe('/');
    expect(sameOriginPath('https://evil.example/?next=https://chhath.shaharpura.com', ORIGIN)).toBe('/');
  });

  it('falls back to / for junk, empty and non-strings', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}, []]) {
      expect(sameOriginPath(bad as never, ORIGIN)).toBe('/');
    }
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of ['http://[', '%', 'https://', ':::']) {
      expect(() => sameOriginPath(bad, ORIGIN)).not.toThrow();
      expect(sameOriginPath(bad, ORIGIN).startsWith('/')).toBe(true);
    }
  });
});

describe('PR-44: both places that act on the payload use it', () => {
  const SW = readFileSync(resolve(process.cwd(), 'static/push-sw.js'), 'utf8');
  const VIEW = readFileSync(
    resolve(process.cwd(), 'src/lib/components/NotificationsView.svelte'), 'utf8');

  it('the service worker resolves the click target through it', () => {
    expect(SW).toMatch(/sameOriginPath\(event\.notification\.data && event\.notification\.data\.url, self\.location\.origin\)/);
    // The raw payload url must not reach navigate()/openWindow() any more.
    expect(SW).not.toMatch(/var target = \(event\.notification\.data && event\.notification\.data\.url\) \|\| '\/';/);
  });

  it('the inbox stores the SAFE url, so the list cannot render a hostile link', () => {
    expect(SW).toMatch(/var url = sameOriginPath\(payload\.url, self\.location\.origin\)/);
  });

  it('the page-side check no longer leans on safeUrl, which allows any https origin', () => {
    expect(VIEW).toMatch(/sameOriginPath\(url,/);
    expect(VIEW, 'safeUrl only tests for ^https?:// — every other origin passed')
      .not.toMatch(/safeUrl\(u\)/);
  });

  it('safeUrl really is that permissive, which is why this PR exists', () => {
    const fmt = readFileSync(resolve(process.cwd(), 'src/lib/utils/format.ts'), 'utf8');
    const body = /export function safeUrl[\s\S]*?\n}/.exec(fmt)![0];
    expect(body).toMatch(/\^https\?:\\\/\\\//);
    expect(body, 'no origin comparison anywhere in it').not.toMatch(/origin/);
  });
});

describe('PR-44: the two copies of the resolver cannot drift', () => {
  it('the shared block is byte-identical in the module and the service worker', () => {
    const START = '// 8< ---- shared with static/push-sw.js — keep byte-identical ----------------------------';
    const END = '// 8< ---- end shared block ---------------------------------------------------------------';
    const mod = readFileSync(resolve(process.cwd(), 'src/lib/pushTarget.js'), 'utf8');
    const sw = readFileSync(resolve(process.cwd(), 'static/push-sw.js'), 'utf8');

    const take = (s: string, label: string) => {
      const i = s.indexOf(START);
      const j = s.indexOf(END);
      expect(i, `${label} has no shared block`).toBeGreaterThan(-1);
      expect(j, `${label} has no end marker`).toBeGreaterThan(i);
      return s.slice(i, j + END.length);
    };

    // push-sw.js is served as a static asset and pulled in with importScripts, so it cannot
    // import anything — see its header. Duplication is forced; drift is not.
    expect(take(sw, 'push-sw.js')).toBe(take(mod, 'pushTarget.js'));
  });

  it('the copy in the service worker is plain ES5-compatible JS, with no TypeScript syntax', () => {
    // It goes to the browser unbuilt. A stray type annotation would be a syntax error that only
    // shows up as "notifications silently stopped working".
    const sw = readFileSync(resolve(process.cwd(), 'static/push-sw.js'), 'utf8');
    const block = sw.slice(sw.indexOf('function sameOriginPath'), sw.indexOf('// 8< ---- end shared block'));
    expect(block).not.toMatch(/:\s*(string|unknown|number|any)\b/);
    expect(block).not.toMatch(/\bexport\b|\bimport\b/);
  });
});

describe('PR-44: the privacy notice covers what the portal actually does', () => {
  const i18n = readFileSync(resolve(process.cwd(), 'src/lib/i18n.ts'), 'utf8');
  const page = readFileSync(resolve(process.cwd(), 'src/routes/privacy/+page.svelte'), 'utf8');
  const SECTIONS = ['chat', 'push', 'offline', 'thirdparty', 'retention', 'rights'];

  it('every new section exists in BOTH languages', () => {
    for (const s of SECTIONS) {
      for (const key of [`privacy_${s}_h`, `privacy_${s}_p`]) {
        const n = (i18n.match(new RegExp(`\\b${key}:`, 'g')) || []).length;
        // One in the English block, one in the Hindi block. I got this wrong first and put both
        // copies in the English object, which svelte-check caught as duplicate keys.
        expect(n, `${key} appears ${n} times, expected 2 (en + hi)`).toBe(2);
      }
    }
  });

  it('the page renders them', () => {
    for (const s of SECTIONS) expect(page).toContain(`'${s}'`);
  });

  it('it names the third party instead of implying there is none', () => {
    // The uncomfortable one: fonts come from Google, so Google sees every visitor's IP. Saying so
    // is the honest interim while the fonts are still remote.
    const en = i18n.slice(0, i18n.indexOf("privacy_subtitle: 'गोपनीयता नीति'"));
    expect(en).toMatch(/Google Fonts/);
    expect(en).toMatch(/IP address/);
  });

  it('it says notifications can be turned off, and what is kept on the device', () => {
    const en = i18n.slice(0, i18n.indexOf("privacy_subtitle: 'गोपनीयता नीति'"));
    expect(en).toMatch(/Turn them off/);
    expect(en).toMatch(/newest 50/);
    expect(en).toMatch(/Clearing site data/);
  });

  it('it warns not to type anything private into the assistant', () => {
    const en = i18n.slice(0, i18n.indexOf("privacy_subtitle: 'गोपनीयता नीति'"));
    expect(en).toMatch(/do not put anything private/i);
  });
});
