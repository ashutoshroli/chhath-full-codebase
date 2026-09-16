// ============ PR-36 — the public portal's dialogs trap nobody ============
// @vitest-environment jsdom
//
// The public portal has FIVE dialogs: the shared `Modal`, plus `AnnouncementPopup`,
// `Chatbot`, `ContributorDetail` and `MoreMenu`, each with its own hand-rolled overlay.
// Every one of them sets `role="dialog"` and `aria-modal="true"` — a promise to assistive
// technology that the rest of the page is unavailable — and then keeps none of it:
//
//   * focus is never moved into the dialog, so a keyboard user who opens one is still
//     standing on the trigger and a screen-reader user is never told anything happened;
//   * Tab walks straight out of the dialog into the page behind it, which `aria-modal`
//     has just told the screen reader does not exist;
//   * focus is never returned when the dialog closes, so the caret lands back at the top
//     of the document and the user has to walk the whole page again;
//   * the background is never marked `inert` or `aria-hidden`, so it stays clickable and
//     readable underneath.
//
// `aria-modal="true"` with no focus management is worse than no dialog role at all: the
// role suppresses the surrounding content in the screen reader's model while the actual
// focus stays in that suppressed content.
//
// These tests pin the behaviour the primitive owes, and a structural check that every one
// of the five dialogs actually uses it — the behaviour is proven on the primitive by
// mounting it for real, and the coverage is proven across all five by source, because a
// primitive nobody adopts fixes nothing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Modal from '../components/Modal.svelte';

// ------------------------------------------------------------------ helpers

let host: HTMLDivElement;
let trigger: HTMLButtonElement;
let background: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';

  // A realistic page: something focusable BEHIND the dialog, and the trigger.
  background = document.createElement('div');
  background.innerHTML = `
    <a href="/somewhere" id="bg-link">a link behind the dialog</a>
    <button id="bg-button">a button behind the dialog</button>
  `;
  document.body.appendChild(background);

  trigger = document.createElement('button');
  trigger.id = 'trigger';
  trigger.textContent = 'Open';
  document.body.appendChild(trigger);

  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  if (app) { unmount(app); app = null; }
});

const tick = () => new Promise((r) => setTimeout(r, 0));

async function openModal(props: Record<string, unknown> = {}) {
  trigger.focus();
  app = mount(Modal, {
    target: host,
    props: { open: true, title: 'Contributors', onclose: () => {}, ...props },
  });
  await tick();
  return host.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement;
}

const focusablesIn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
  )];

// `import.meta.url` is not a filesystem URL under vite's transform, so resolve from the
// project root instead.
const readComponent = (file: string) =>
  readFileSync(resolve(process.cwd(), 'src/lib/components', file), 'utf8');

const press = (key: string, opts: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

// ------------------------------------------------- 1. FOCUS ENTERS THE DIALOG

describe('PR-36: opening a dialog moves focus into it', () => {
  it('focus is inside the dialog, not left on the trigger', async () => {
    const dialog = await openModal();
    expect(dialog).toBeTruthy();
    // THE ASSERTION THAT FAILS ON `main`: activeElement is still #trigger.
    expect(document.activeElement).not.toBe(trigger);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('the dialog is named by its visible heading, not by a duplicated string', async () => {
    const dialog = await openModal();
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy, 'a dialog must be named by the heading the sighted user reads').toBeTruthy();
    const heading = dialog.querySelector(`#${labelledBy}`);
    expect(heading?.textContent?.trim()).toBe('Contributors');
  });

  it('a dialog with no title is still named rather than silently anonymous', async () => {
    const dialog = await openModal({ title: '' });
    const name =
      dialog.getAttribute('aria-label') ||
      dialog.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent?.trim();
    expect(name, 'an unnamed dialog is announced only as "dialog"').toBeTruthy();
  });
});

// ------------------------------------------------------- 2. TAB CANNOT ESCAPE

describe('PR-36: Tab is trapped inside the dialog', () => {
  it('Tab from the last focusable wraps to the first, not out to the page', async () => {
    const dialog = await openModal();
    const items = focusablesIn(dialog);
    expect(items.length, 'the fixture needs at least one focusable inside').toBeGreaterThan(0);

    items[items.length - 1].focus();
    const e = press('Tab');

    // THE ASSERTION THAT FAILS ON `main`: nothing handles Tab, so it is not prevented
    // and the browser would move focus to #bg-link behind the dialog.
    expect(e.defaultPrevented, 'Tab at the end must be handled, not left to the browser').toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Shift+Tab from the first focusable wraps to the last', async () => {
    const dialog = await openModal();
    const items = focusablesIn(dialog);
    items[0].focus();
    const e = press('Tab', { shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('focus that has somehow landed outside is pulled back on the next Tab', async () => {
    const dialog = await openModal();
    document.getElementById('bg-button')!.focus();
    press('Tab');
    expect(dialog.contains(document.activeElement),
      'a dialog claiming aria-modal must not leave focus in the page behind it').toBe(true);
  });
});

// ---------------------------------------------- 3. THE BACKGROUND IS INERT

describe('PR-36: the page behind is actually unavailable', () => {
  it('the background is marked inert or aria-hidden while the dialog is open', async () => {
    await openModal();
    // NOTE: jsdom does not implement `inert` behaviour, so this asserts the ATTRIBUTE is
    // applied — the part we control. The browser enforces the rest.
    const hidden = background.hasAttribute('inert') || background.getAttribute('aria-hidden') === 'true';
    expect(hidden, 'aria-modal promises this; something has to deliver it').toBe(true);
  });

  it('the background is released when the dialog closes', async () => {
    await openModal();
    unmount(app!); app = null;
    await tick();
    expect(background.hasAttribute('inert')).toBe(false);
    expect(background.getAttribute('aria-hidden')).not.toBe('true');
  });

  it('body scroll is locked while open and restored after', async () => {
    await openModal();
    expect(document.body.style.overflow).toBe('hidden');
    unmount(app!); app = null;
    await tick();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

// ------------------------------------------------- 4. FOCUS COMES BACK

describe('PR-36: closing returns focus where it came from', () => {
  it('focus returns to the element that opened the dialog', async () => {
    const dialog = await openModal();

    // This precondition is the whole test. Asserting only "focus is on the trigger after
    // closing" PASSES ON `main` for the wrong reason — focus never moved in the first
    // place, so it is trivially still there. Prove it left, then prove it came back.
    expect(dialog.contains(document.activeElement),
      'focus must be inside the dialog before "returning" it means anything').toBe(true);
    expect(document.activeElement).not.toBe(trigger);

    unmount(app!); app = null;
    await tick();
    expect(document.activeElement).toBe(trigger);
  });
});

// ------------------------------------------------------------ 5. ESCAPE

describe('PR-36: Escape closes the dialog, and only when it is open', () => {
  it('Escape calls onclose', async () => {
    let closed = 0;
    await openModal({ onclose: () => closed++ });
    press('Escape');
    expect(closed).toBe(1);
  });

  it('Escape does NOT fire when the dialog is closed', async () => {
    // `main` registers the keydown handler on <svelte:window> OUTSIDE the {#if open}
    // block, so a mounted-but-closed dialog still reacts to Escape anywhere on the page —
    // cancelling unrelated UI state for a dialog the user cannot even see.
    let closed = 0;
    trigger.focus();
    app = mount(Modal, { target: host, props: { open: false, title: 'X', onclose: () => closed++ } });
    await tick();
    press('Escape');
    expect(closed, 'a closed dialog must not respond to Escape').toBe(0);
  });
});

// -------------------------------------- 6. EVERY DIALOG ADOPTS THE PRIMITIVE

describe('PR-36: all five public dialogs use the shared behaviour', () => {
  // A primitive nobody adopts fixes nothing. Behaviour is proven above by mounting the
  // primitive; this proves the reach. Source-level on purpose: Chatbot is a docked panel
  // and MoreMenu is a sheet, so they cannot all wear Modal's chrome — what they must share
  // is the BEHAVIOUR, applied through the `use:dialog` action.
  const FILES = [
    'Modal.svelte',
    'AnnouncementPopup.svelte',
    'Chatbot.svelte',
    'ContributorDetail.svelte',
    'MoreMenu.svelte',
  ];

  for (const file of FILES) {
    it(`${file} wires the dialog action`, () => {
      const src = readComponent(file);
      // `role` may be a literal or computed (Modal switches to alertdialog when destructive).
      expect(src, `${file} declares a dialog role`).toMatch(/role=("(alert)?dialog"|\{)/);
      expect(src, `${file} must use the shared dialog behaviour`).toMatch(/use:dialog/);
      expect(src).toMatch(/from ['"]\$lib\/a11y\/dialog(\.js)?['"]/);
    });
  }

  it('the ARIA and the keyboard behaviour agree about which dialogs are modal', () => {
    // The bug this PR fixes was a disagreement between the two: `aria-modal="true"` with no
    // trap. Fixing it by trapping everything would introduce the mirror-image lie, so the
    // rule is checked in BOTH directions — anything claiming aria-modal must trap, and the
    // one panel that does not claim it must not.
    for (const file of FILES) {
      const src = readComponent(file);
      const claimsModal = /aria-modal="true"/.test(src);
      const optsOut = /modal:\s*false/.test(src);
      if (claimsModal) {
        expect(optsOut, `${file} claims aria-modal, so it must NOT pass modal:false`).toBe(false);
      } else {
        expect(optsOut, `${file} has no aria-modal, so it must pass modal:false rather than trap`).toBe(true);
      }
    }
  });

  it('no dialog hand-rolls its own Escape handling any more', () => {
    for (const file of FILES) {
      const src = readComponent(file);
      expect(src.includes('svelte:window onkeydown'),
        `${file} still has a window-level key handler; Escape belongs to the action`).toBe(false);
    }
  });
});
