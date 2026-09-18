// The Contributor Details card must show the member's profile photo when there is
// one, and fall back to the initials avatar when there is no photo OR the image
// fails to load. Before this fix the card rendered ONLY the initials avatar and
// never referenced `photo`, so the photo was invisible in every skin.
//
// Two layers are pinned here:
//   * the pure decision `shouldShowPhoto(photo, failed)` (a node test), and
//   * the actual render of ContributorDetail (a jsdom component test) — photo
//     present -> <img> with the right src; photo '' -> initials; img error ->
//     initials fallback. These would fail if the <img> were removed again.
//
// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ContributorDetail from './ContributorDetail.svelte';
import { shouldShowPhoto } from '$lib/utils/format';
import type { Ranked } from '$lib/utils/ranking';
import type { Contributor } from '$lib/api/derive';

// --------------------------------------------------------------- fixtures

function contributor(overrides: Partial<Contributor> = {}): Contributor {
  return {
    key: 'k1',
    name: 'Ravi Kumar',
    nameHindi: '',
    amount: 5100,
    village: 'Shaharpura',
    villageHindi: '',
    designation: '',
    designationHindi: '',
    fatherName: '',
    fatherNameHindi: '',
    count: 1,
    order: 0,
    hasMoney: true,
    kinds: new Set(['money']),
    detail: '',
    year: '2026',
    photo: '',
    ...overrides,
  };
}

const ranked = (c: Contributor): Ranked<Contributor> => ({ item: c, rank: 7, isTop: false });

let app: ReturnType<typeof mount> | null = null;
let host: HTMLDivElement;

afterEach(() => {
  if (app) { unmount(app); app = null; }
});

function render(entry: Ranked<Contributor> | null) {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(ContributorDetail, { target: host, props: { entry, onclose: () => {} } });
  flushSync();
}

const avatarInitials = () =>
  [...document.querySelectorAll('span')].find((s) => /place-items-center/.test(s.className));

// -------------------------------------------------- 1. pure decision helper

describe('shouldShowPhoto', () => {
  it('shows the photo only with a non-empty url and no load failure', () => {
    expect(shouldShowPhoto('https://cdn/x.jpg', false)).toBe(true);
  });
  it('hides the photo when there is no url', () => {
    expect(shouldShowPhoto('', false)).toBe(false);
    expect(shouldShowPhoto(null, false)).toBe(false);
    expect(shouldShowPhoto(undefined, false)).toBe(false);
  });
  it('hides the photo once the image has failed to load', () => {
    expect(shouldShowPhoto('https://cdn/x.jpg', true)).toBe(false);
  });
});

// -------------------------------------------------- 2. render behaviour

describe('ContributorDetail photo vs initials', () => {
  it('renders the <img src=photo> when the contributor has a photo', () => {
    render(ranked(contributor({ photo: 'https://cdn.example/ravi.jpg' })));
    const img = host.querySelector('img');
    expect(img, 'a contributor with a photo must render an <img>').toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://cdn.example/ravi.jpg');
    expect(img!.getAttribute('alt')).toBe('Ravi Kumar');
  });

  it('renders the initials avatar (no <img>) when photo is empty', () => {
    render(ranked(contributor({ photo: '' })));
    expect(host.querySelector('img'), 'no photo means no <img>').toBeNull();
    expect(avatarInitials(), 'the initials avatar must be shown instead').toBeTruthy();
    expect(avatarInitials()!.textContent?.trim()).toBe('RK');
  });

  it('falls back to initials when the image errors', () => {
    render(ranked(contributor({ photo: 'https://cdn.example/broken.jpg' })));
    const img = host.querySelector('img');
    expect(img).toBeTruthy();
    img!.dispatchEvent(new Event('error'));
    flushSync();
    expect(host.querySelector('img'), 'a broken image must be replaced by the fallback').toBeNull();
    expect(avatarInitials(), 'the initials avatar must take over on error').toBeTruthy();
  });
});
