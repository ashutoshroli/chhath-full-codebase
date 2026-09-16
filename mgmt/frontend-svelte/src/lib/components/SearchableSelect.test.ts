// ====== PR-38 — the contributor picker cannot be operated by keyboard at all ======
// @vitest-environment jsdom
//
// `SearchableSelect` is the control used to choose WHO a contribution, a loan or a
// guarantee belongs to. It is mounted in five places, every one of them a money path:
// the collection form (Home), the loan receiver and its three guarantors (Loans), and the
// replacement guarantor (LoanConsentModal).
//
// It had no keyboard operation whatsoever. Options were `<div onclick>`: not focusable, not
// activatable, no ArrowDown, no Enter, no Escape. A keyboard-only operator could type a
// search and then had no way to choose any result — the money could not be attributed at
// all without a mouse.
//
// It also had no ARIA. No `role="combobox"`, no `aria-expanded`, no `role="listbox"`, no
// `role="option"`, no `aria-activedescendant`. A screen-reader user got a plain text box,
// was never told a list had appeared, and was never told what was highlighted.
//
// These tests pin the ARIA 1.2 combobox contract, and — more importantly — that the control
// can be driven end to end from the keyboard.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import SearchableSelect from './SearchableSelect.svelte';
import { reactiveProps } from '../a11y/reactiveProps.svelte';

const OPTIONS = [
  { value: 'USER0002', label: 'Ram Kumar', sub: 'Gardih · s/o Shyam' },
  { value: 'USER0003', label: 'Sita Devi', sub: 'Shaharpura · d/o Ram' },
  { value: 'USER0004', label: 'Gita Kumari', sub: 'Gardih · d/o Mohan' },
];

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;
let chosen: string[] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  chosen = [];
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => { if (app) { unmount(app); app = null; } });

const tick = () => new Promise((r) => setTimeout(r, 0));

async function render(props: Record<string, unknown> = {}) {
  app = mount(SearchableSelect, {
    target: host,
    props: { options: OPTIONS, value: '', onChange: (v: string) => chosen.push(v), ...props },
  });
  await tick();
  return host.querySelector('input') as HTMLInputElement;
}

const key = async (el: Element, k: string, opts: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  el.dispatchEvent(e);
  await tick();
  return e;
};

const type = async (input: HTMLInputElement, text: string) => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
};

const openList = async () => {
  const input = await render();
  input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  await tick();
  return input;
};

const listbox = () => host.querySelector('[role="listbox"]') as HTMLElement | null;
const options = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')];

// --------------------------------------------------- 1. IT IS A COMBOBOX

describe('PR-38: the picker declares what it is', () => {
  it('the input is a combobox that reports whether the list is open', async () => {
    const input = await render();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');

    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await tick();
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('the input points at the list it controls', async () => {
    const input = await openList();
    const controls = input.getAttribute('aria-controls');
    expect(controls, 'aria-controls must name the listbox').toBeTruthy();
    expect(document.getElementById(controls!)?.getAttribute('role')).toBe('listbox');
  });

  it('the results are options, not anonymous divs', async () => {
    await openList();
    expect(listbox()).toBeTruthy();
    expect(options().length).toBe(OPTIONS.length);
    expect(options()[0].textContent).toContain('Ram Kumar');
  });

  it('the currently chosen person is marked selected', async () => {
    const input = await render({ value: 'USER0003' });
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await tick();
    const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toContain('Sita Devi');
  });
});

// ------------------------------------- 2. IT CAN BE DRIVEN FROM THE KEYBOARD

describe('PR-38: a keyboard-only operator can attribute the money', () => {
  it('ArrowDown opens the list and highlights the first option', async () => {
    const input = await render();
    await key(input, 'ArrowDown');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const active = input.getAttribute('aria-activedescendant');
    expect(active, 'the highlighted option must be named for the screen reader').toBeTruthy();
    expect(document.getElementById(active!)?.textContent).toContain('Ram Kumar');
  });

  it('ArrowDown / ArrowUp move the highlight and stop at the ends', async () => {
    const input = await openList();
    await key(input, 'ArrowDown'); // 0
    await key(input, 'ArrowDown'); // 1
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent)
      .toContain('Sita Devi');
    await key(input, 'ArrowUp'); // 0
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent)
      .toContain('Ram Kumar');
    await key(input, 'ArrowUp'); // clamped, not wrapped past the top
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent)
      .toContain('Ram Kumar');
  });

  it('Enter chooses the highlighted person — THE thing that was impossible', async () => {
    const input = await openList();
    await key(input, 'ArrowDown');
    await key(input, 'ArrowDown');
    await key(input, 'Enter');
    expect(chosen, 'a keyboard user must be able to pick a contributor').toEqual(['USER0003']);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('Enter with nothing highlighted does not choose a person by accident', async () => {
    const input = await openList();
    await key(input, 'Enter');
    expect(chosen).toEqual([]);
  });

  it('Escape closes the list without choosing', async () => {
    const input = await openList();
    await key(input, 'ArrowDown');
    await key(input, 'Escape');
    expect(chosen).toEqual([]);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('Home and End jump to the first and last match', async () => {
    const input = await openList();
    await key(input, 'End');
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent)
      .toContain('Gita Kumari');
    await key(input, 'Home');
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent)
      .toContain('Ram Kumar');
  });

  it('typing CLEARS the highlight, so Enter cannot commit a name nobody looked at', async () => {
    // A deliberate choice, and the two ARIA combobox patterns disagree here. "Automatic
    // selection" highlights the first match as you type, so Enter picks it; "manual
    // selection" does not, and Enter with nothing highlighted does nothing.
    //
    // This control decides who money is attributed to. Automatic selection means a fast
    // typist who presses Enter one keystroke early commits a person they never read — with a
    // list of ~2,000 similar Bhojpuri names, several of which differ only by father's name
    // (see C15/C16), that is a real misattribution, not a theoretical one. So: manual.
    //
    // My first version of this test asserted the opposite and contradicted the "Enter with
    // nothing highlighted does not choose" test three cases above it. Recorded here because
    // the safe behaviour is the less obvious one.
    const input = await openList();
    await key(input, 'End');           // highlight the 3rd of 3
    await type(input, 'Sita');         // one match now, and the highlight is dropped
    expect(options().length).toBe(1);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    await key(input, 'Enter');
    expect(chosen, 'Enter must not pick the sole match implicitly').toEqual([]);

    // The operator arrows onto it deliberately, and THEN Enter commits.
    await key(input, 'ArrowDown');
    await key(input, 'Enter');
    expect(chosen).toEqual(['USER0003']);
  });

  it('the highlight survives the parent replacing the option list', async () => {
    // The real path: Home and Loans reload `contributorOptions` after the "+" button adds a
    // member. If the list gets SHORTER while a highlight is active, a raw index would point
    // `aria-activedescendant` at an option that no longer exists — and Enter would read
    // `filtered[stale]` as undefined.
    //
    // This case is why `reactiveProps` exists: mutating the plain object passed to `mount()`
    // does nothing, so without it the clamp was untested and a mutation removing it passed
    // the whole suite. Found by mutation testing, not by review.
    const props = reactiveProps({
      options: OPTIONS as { value: string; label: string; sub?: string }[],
      value: '',
      onChange: (v: string) => { chosen.push(v); },
    });
    app = mount(SearchableSelect, { target: host, props });
    await tick();
    const input = host.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await tick();

    await key(input, 'End'); // highlight the 3rd of 3
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent)
      .toContain('Gita Kumari');

    props.options = [OPTIONS[0]]; // the parent reloads and the list shrinks to one
    await tick();

    const id = input.getAttribute('aria-activedescendant');
    if (id) expect(document.getElementById(id), `activedescendant "${id}" dangles`).toBeTruthy();
    await key(input, 'Enter');
    expect(chosen, 'Enter must commit a real option or nothing — never undefined').toEqual(['USER0002']);
  });

  it('aria-activedescendant never points at an option that does not exist', async () => {
    // A dangling reference is announced as nothing at all, so the highlight becomes
    // invisible to a screen reader while still looking highlighted on screen.
    const input = await openList();
    const check = () => {
      const id = input.getAttribute('aria-activedescendant');
      if (id) expect(document.getElementById(id), `activedescendant "${id}" dangles`).toBeTruthy();
    };
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'End', 'ArrowUp', 'Home']) {
      await key(input, k);
      check();
    }
    await type(input, 'Gita');
    check();
    await key(input, 'ArrowDown');
    check();
    await type(input, '');
    check();
  });

  it('Tab leaves the control without choosing, and closes the list', async () => {
    const input = await openList();
    await key(input, 'ArrowDown');
    await key(input, 'Tab');
    expect(chosen).toEqual([]);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

// ------------------------------------------------ 3. THE MOUSE STILL WORKS

describe('PR-38: the mouse path is unchanged', () => {
  it('clicking an option still chooses it', async () => {
    await openList();
    options()[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(chosen).toEqual(['USER0004']);
  });

  it('"No matches" is announced rather than being an empty silence', async () => {
    const input = await openList();
    await type(input, 'zzzzz');
    expect(options().length).toBe(0);
    const status = host.querySelector('[role="status"], [aria-live]');
    expect(status?.textContent).toMatch(/no match/i);
  });
});

// ------------------------------------------------ 4. TOUCH TARGET SIZE

describe('PR-38: the add-new control is a real target', () => {
  it('is a button with an accessible name and a 44px minimum', async () => {
    await render({ onAddNew: () => {} });
    const add = [...host.querySelectorAll('button')].find(
      (b) => /add/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''),
    );
    expect(add, 'the add-new control must exist and be a button').toBeTruthy();
    expect(add!.getAttribute('aria-label'), 'a title alone is not an accessible name on touch').toBeTruthy();
    const style = add!.getAttribute('style') || '';
    expect(style, 'WCAG 2.5.5: a 44px target').toMatch(/min-height\s*:\s*44px/);
  });
});
