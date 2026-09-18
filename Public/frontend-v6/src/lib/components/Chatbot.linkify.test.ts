// Pins the actual RENDER of the chat transcript: a bot reply that contains a
// markdown-autolink `<https://...>` URL must produce a clickable <a> that opens
// in a new tab safely (target=_blank + rel with noopener), shows NO angle
// brackets, and carries a wrap class so a long URL cannot overflow the bubble.
// This regression-guards the plain-`{m.text}` bug (audit PUB-FE-02). Follows the
// mount/unmount/flushSync jsdom pattern from ContributorDetail.test.ts.
//
// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Chatbot from './Chatbot.svelte';

let app: ReturnType<typeof mount> | null = null;
let host: HTMLDivElement;

afterEach(() => {
  if (app) {
    unmount(app);
    app = null;
  }
});

const LONG_URL =
  'https://host.example.com/very/long/path/that/would/otherwise/overflow/the-bubble/document-final-v2.pdf';

function render(seedMessages: Array<{ role: 'user' | 'bot'; text: string }>) {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(Chatbot, { target: host, props: { open: true, seedMessages } });
  flushSync();
}

describe('Chatbot transcript link rendering', () => {
  it('renders a bot autolink as a safe, clickable, wrapping <a>', () => {
    render([{ role: 'bot', text: `Here is the file: <${LONG_URL}>` }]);

    const anchor = host.querySelector('a[href^="https://"]') as HTMLAnchorElement | null;
    expect(anchor, 'a bot URL must render as a real anchor').toBeTruthy();
    expect(anchor!.getAttribute('href')).toBe(LONG_URL);
    expect(anchor!.getAttribute('target')).toBe('_blank');
    expect(anchor!.getAttribute('rel') || '').toContain('noopener');

    // Angle brackets from the autolink syntax must be gone from the visible text.
    expect(anchor!.textContent).not.toContain('<');
    expect(anchor!.textContent).not.toContain('>');

    // A wrap class must be present on the anchor and/or bubble so a long URL
    // breaks instead of overflowing max-w-[80%].
    const bubble = anchor!.closest('div');
    const wraps = (el: Element | null) =>
      !!el && (/break-words/.test(el.className) || /overflow-wrap/.test(el.className));
    expect(wraps(anchor) || wraps(bubble)).toBe(true);
  });

  it('does not turn a javascript: URL into an anchor', () => {
    render([{ role: 'bot', text: 'javascript:alert(1)' }]);
    expect(host.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
