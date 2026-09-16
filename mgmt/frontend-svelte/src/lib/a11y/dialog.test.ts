// ============ PR-37 — the management portal's modals are not dialogs at all ============
// @vitest-environment jsdom
//
// The public portal's dialogs at least CLAIMED to be dialogs (PR-36 made the claim true).
// The mgmt portal's shared `Modal` — used by TWENTY-THREE call sites, i.e. every modal in
// the app — claims nothing:
//
//     <div class="modal-overlay" onclick={...}>
//       <div class="modal-content"> … </div>
//     </div>
//
// No `role`, no `aria-modal`, no accessible name, no Escape, no focus handling, no scroll
// lock. To a screen reader this is an anonymous `<div>` that happens to appear: the user is
// never told a dialog opened, is given no boundary, and can Tab through the whole page
// behind it while the "modal" sits on top. There is not even a keyboard way out — Escape
// did nothing, so a keyboard-only user had to find the close button by Tabbing.
//
// This is the same fix as PR-36, applied through the SAME action, which is kept
// byte-identical between the two apps and pinned by a test below.
//
// One deliberate difference from PR-36: the mgmt modals already render their own `<h3>`
// inside the content, so the dialog is named by pointing `aria-labelledby` at THAT heading
// rather than having the primitive render a header of its own. That keeps every one of the
// 23 screens visually identical — which matters, because I cannot see them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Modal from '../components/Modal.svelte';

let host: HTMLDivElement;
let trigger: HTMLButtonElement;
let background: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  background = document.createElement('div');
  background.innerHTML = `<a href="/x" id="bg-link">behind</a><button id="bg-button">behind</button>`;
  document.body.appendChild(background);
  trigger = document.createElement('button');
  trigger.id = 'trigger';
  document.body.appendChild(trigger);
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => { if (app) { unmount(app); app = null; } });

const tick = () => new Promise((r) => setTimeout(r, 0));

async function openModal(props: Record<string, unknown> = {}) {
  trigger.focus();
  app = mount(Modal, { target: host, props: { open: true, onClose: () => {}, title: 'Add User', ...props } });
  await tick();
  return host.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement;
}

const focusablesIn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];

const press = (key: string, opts: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

// ------------------------------------------------- 1. IT IS A DIALOG NOW

describe('PR-37: the mgmt modal is announced as a dialog', () => {
  it('has a dialog role and aria-modal', async () => {
    const dialog = await openModal();
    // THE ASSERTION THAT FAILS ON `main`: there is no [role="dialog"] in the tree at all.
    expect(dialog, 'the modal must be a dialog, not an anonymous div').toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('is named — by the content heading when one is given, else by its title', async () => {
    const byTitle = await openModal({ title: 'Add User' });
    expect(byTitle.getAttribute('aria-label')).toBe('Add User');
    unmount(app!); app = null;

    const heading = document.createElement('h3');
    heading.id = 'dlg-x-title';
    heading.textContent = 'Edit Collection';
    // A caller that points at its own heading must win over any fallback.
    app = mount(Modal, { target: host, props: { open: true, onClose: () => {}, labelledBy: 'dlg-x-title' } });
    await tick();
    const byId = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(byId.getAttribute('aria-labelledby')).toBe('dlg-x-title');
    expect(byId.getAttribute('aria-label')).toBeNull();
  });

  it('renders as alertdialog when the answer is destructive', async () => {
    const dialog = await openModal({ destructive: true });
    expect(dialog.getAttribute('role')).toBe('alertdialog');
  });
});

// --------------------------------------------- 2. THE BEHAVIOUR FROM PR-36

describe('PR-37: focus, Escape and the background', () => {
  it('focus moves into the dialog', async () => {
    const dialog = await openModal();
    expect(document.activeElement).not.toBe(trigger);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Tab wraps instead of walking into the page behind', async () => {
    const dialog = await openModal();
    const items = focusablesIn(dialog);
    expect(items.length).toBeGreaterThan(0);
    items[items.length - 1].focus();
    const e = press('Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes it — there was no keyboard way out before', async () => {
    let closed = 0;
    await openModal({ onClose: () => closed++ });
    press('Escape');
    expect(closed).toBe(1);
  });

  it('the page behind goes inert and is released on close', async () => {
    await openModal();
    expect(background.hasAttribute('inert') || background.getAttribute('aria-hidden') === 'true').toBe(true);
    unmount(app!); app = null;
    await tick();
    expect(background.hasAttribute('inert')).toBe(false);
  });

  it('body scroll locks and unlocks', async () => {
    await openModal();
    expect(document.body.style.overflow).toBe('hidden');
    unmount(app!); app = null;
    await tick();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('focus returns to the opener', async () => {
    const dialog = await openModal();
    // Precondition, or this passes for the wrong reason (see PR-36).
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount(app!); app = null;
    await tick();
    expect(document.activeElement).toBe(trigger);
  });

  it('a closed modal ignores Escape', async () => {
    let closed = 0;
    app = mount(Modal, { target: host, props: { open: false, onClose: () => closed++, title: 'X' } });
    await tick();
    press('Escape');
    expect(closed).toBe(0);
  });
});

// ------------------------------------------- 3. EVERY CALL SITE IS NAMED

describe('PR-37: all 23 modal call sites are labelled', () => {
  // A dialog with no accessible name is announced as just "dialog". The primitive cannot
  // invent a name, so the contract has to be enforced where the names live.
  const SRC = resolve(process.cwd(), 'src');

  function svelteFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return svelteFiles(full);
      return full.endsWith('.svelte') ? [full] : [];
    });
  }

  /**
   * The index of the `>` that closes the tag starting at `from`, skipping over `{…}`
   * expressions and quoted strings.
   *
   * A plain `/<Modal\b[^>]*>/` is WRONG here and I had it wrong first: half these call sites
   * pass `onClose={() => …}`, so `[^>]*` stops at the arrow's `>` and the captured "tag" is
   * truncated before the attributes that follow. That made this test report four
   * correctly-named dialogs as unnamed.
   */
  function tagEnd(src: string, from: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (c === '>' && depth === 0) return i;
    }
    return -1;
  }

  // Every `<Modal ...>` opening tag in the app, with its file and full attribute text.
  function modalTags() {
    const out: { file: string; tag: string }[] = [];
    for (const file of svelteFiles(SRC)) {
      // Not Modal.svelte's own definition.
      if (file.endsWith('components/Modal.svelte')) continue;
      const src = readFileSync(file, 'utf8');
      const re = /<Modal\b/g;
      let m;
      while ((m = re.exec(src))) {
        const end = tagEnd(src, m.index);
        if (end === -1) continue;
        out.push({ file: file.slice(SRC.length + 1), tag: src.slice(m.index, end + 1) });
      }
    }
    return out;
  }

  it('finds every call site (guards against a vacuous pass)', () => {
    const tags = modalTags();
    expect(tags.length, `expected ~23 <Modal> call sites, found ${tags.length}`).toBeGreaterThanOrEqual(23);
  });

  it('each passes labelledBy or title', () => {
    const unnamed = modalTags()
      .filter(({ tag }) => !/\blabelledBy\b/.test(tag) && !/\btitle\b/.test(tag))
      .map(({ file, tag }) => `${file}: ${tag.slice(0, 80)}`);
    expect(unnamed, 'an unnamed dialog is announced only as "dialog"').toEqual([]);
  });

  it('every labelledBy points at an id that exists in the same file', () => {
    const broken: string[] = [];
    for (const file of svelteFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<Modal\b[^>]*\blabelledBy=["']([^"']+)["'][^>]*>/g)) {
        const id = m[1];
        if (!new RegExp(`id=["']${id}["']`).test(src)) {
          broken.push(`${file.slice(SRC.length + 1)}: labelledBy="${id}" has no matching id`);
        }
      }
    }
    // A dangling aria-labelledby is WORSE than none: the dialog is announced as unnamed and
    // nothing reports the mistake.
    expect(broken).toEqual([]);
  });
});

// --------------------------------- 4. THE TWO APPS CANNOT DRIFT APART

describe('PR-37: the dialog behaviour is one implementation, not two', () => {
  it('mgmt and public share a byte-identical dialog.ts', () => {
    const mine = readFileSync(resolve(process.cwd(), 'src/lib/a11y/dialog.ts'));
    const theirs = readFileSync(
      resolve(process.cwd(), '../../Public/frontend-v6/src/lib/a11y/dialog.ts'),
    );
    // The two apps are separate builds with separate node_modules, so there is no package to
    // import across. Copying is the only option available without introducing monorepo
    // tooling; what must not happen is the copies diverging, so that is asserted rather than
    // hoped for. If this fails, copy the file — do not patch one side.
    expect(mine.equals(theirs),
      'mgmt/frontend-svelte and Public/frontend-v6 dialog.ts have diverged').toBe(true);
  });
});
