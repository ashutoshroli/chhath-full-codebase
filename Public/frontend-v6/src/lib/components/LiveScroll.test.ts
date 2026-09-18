// The contributor rail is the ONE live right-to-left showcase, and after FEAT-003
// it is the SAME shared component (LiveScroll) in every skin that has a horizontal
// rail (premium + aurora), so its controls must stay wired everywhere.
//
// This pins the control surface a skin relies on:
//   * the prev (◀) / pause / next (▶) buttons all render,
//   * clicking next (and prev) drives the scroll container via scrollBy — i.e. the
//     right-to-left nudge is actually wired, not a dead button,
//   * the pause/play toggle flips aria-pressed (the "live" on/off state), and
//   * clicking a contributor card fires onselect(key) — the tap-to-open-detail
//     path that FEAT-002 depends on.
// These would fail if the nudge()/pause wiring or the card onselect were removed.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import LiveScroll from './LiveScroll.svelte';
import { portalState, year } from '$lib/stores/portal';
import { parsePortalData, EMPTY_PORTAL_DATA } from '$lib/api/schema';

// A dataset with > 3 contributors so `canLoop` is true and the rail + controls
// render (mirrors the reference contributor set used elsewhere).
const sample = {
  users: [
    { ID: 'U1', Name: 'Ravi Kumar', Village: 'Shaharpura' },
    { ID: 'U2', Name: 'Sanjeet Kumar', Village: 'Gardih' },
    { ID: 'U3', Name: 'Abhishek Verma', Village: 'Shaharpura' },
    { ID: 'U4', Name: 'Govind Verma', Village: 'Gardih' },
    { ID: 'U5', Name: 'Pintu Kumar', Village: 'Shaharpura' },
    { ID: 'U6', Name: 'Aarohi Bharti', Village: 'Gardih' }
  ],
  collections: [
    { Year: 2026, ID: 'U1', Amount: '2100', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U2', Amount: '2100', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U3', Amount: '1501', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U4', Amount: '1000', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U5', Amount: '1000', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U6', Amount: '786', 'Contribution Type': '1' }
  ],
  expenses: [],
  loans: [],
  committee: [],
  guarantors: [],
  generatedFiles: [],
  loanConsents: []
};

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  const data = parsePortalData(sample)!;
  portalState.set({
    status: 'ready',
    data,
    stale: false,
    savedAt: Date.now(),
    version: 't',
    failed: false,
    source: 'network'
  });
  year.set(2026);
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  if (app) { unmount(app); app = null; }
  document.body.innerHTML = '';
  portalState.set({
    status: 'loading',
    data: EMPTY_PORTAL_DATA,
    stale: false,
    savedAt: 0,
    version: '',
    failed: false,
    source: 'empty'
  });
});

function render(props: { onselect?: (key: string) => void; oncountclick?: () => void } = {}) {
  app = mount(LiveScroll, { target: host, props });
  flushSync();
}

// buttons carry an aria-label; look them up by it so the test tracks intent, not order.
const byLabel = (labelPart: RegExp) =>
  [...host.querySelectorAll('button')].find((b) => labelPart.test(b.getAttribute('aria-label') ?? ''));

describe('LiveScroll controls (shared across skins)', () => {
  it('renders the prev / pause / next controls', () => {
    render();
    expect(byLabel(/prev/i), 'prev button must exist').toBeTruthy();
    expect(byLabel(/next/i), 'next button must exist').toBeTruthy();
    // pause/play toggle starts as "pause" (auto-scroll running).
    expect(byLabel(/pause|play/i), 'pause/play toggle must exist').toBeTruthy();
  });

  it('nudges the scroll container to the right when Next is clicked', () => {
    render();
    const track = host.querySelector('[role="list"]') as HTMLElement;
    expect(track, 'the scroll track must be present').toBeTruthy();
    const scrollBy = vi.fn();
    track.scrollBy = scrollBy as unknown as HTMLElement['scrollBy'];

    byLabel(/next/i)!.click();
    flushSync();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ left: 240 });
  });

  it('nudges left when Prev is clicked', () => {
    render();
    const track = host.querySelector('[role="list"]') as HTMLElement;
    const scrollBy = vi.fn();
    track.scrollBy = scrollBy as unknown as HTMLElement['scrollBy'];

    byLabel(/prev/i)!.click();
    flushSync();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ left: -240 });
  });

  it('flips aria-pressed on the pause/play toggle', () => {
    render();
    const toggle = byLabel(/pause|play/i)!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    flushSync();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    flushSync();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('fires onselect(key) when a contributor card is clicked (tap-to-open detail)', () => {
    const onselect = vi.fn();
    render({ onselect });
    // the contributor cards are the buttons inside the scroll track.
    const track = host.querySelector('[role="list"]') as HTMLElement;
    const card = track.querySelector('button') as HTMLButtonElement;
    expect(card, 'a contributor card button must exist').toBeTruthy();
    card.click();
    flushSync();
    expect(onselect).toHaveBeenCalledTimes(1);
    expect(typeof onselect.mock.calls[0][0]).toBe('string');
    expect(onselect.mock.calls[0][0].length).toBeGreaterThan(0);
  });

  it('fires oncountclick when the "view list" affordance is clicked', () => {
    const oncountclick = vi.fn();
    render({ oncountclick });
    byLabel(/view contributor/i)!.click();
    flushSync();
    expect(oncountclick).toHaveBeenCalledTimes(1);
  });
});
