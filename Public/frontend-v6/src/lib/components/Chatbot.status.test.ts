// Pins how the chat widget surfaces server failures. The backend returns HTTP
// 503 when its daily token budget is exhausted or it is momentarily busy, and
// 429 for the per-IP rate limit. The widget must show the real reason for a 503
// (the server's own error string, or the localized chat_limit fallback) instead
// of masking it with the generic chat_error, and a successful reply that carries
// a URL must still render a clickable <a> (regression guard for PR#406). Follows
// the mount/unmount/flushSync jsdom pattern from Chatbot.linkify.test.ts. send()
// calls fetch, so global fetch is stubbed to return a Response-like object.
//
// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Chatbot from './Chatbot.svelte';
import { T } from '$lib/i18n';

let app: ReturnType<typeof mount> | null = null;
let host: HTMLDivElement;

afterEach(() => {
  if (app) {
    unmount(app);
    app = null;
  }
  vi.unstubAllGlobals();
});

/** A minimal Response-like object matching what send() reads: ok, status, json(). */
function fakeResponse(status: number, ok: boolean, body: unknown) {
  return { ok, status, json: async () => body } as unknown as Response;
}

function render() {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(Chatbot, { target: host, props: { open: true } });
  flushSync();
}

/** Type a question into the input and click Send, then let the awaited fetch/json settle. */
async function ask(question: string) {
  const inputEl = host.querySelector('input') as HTMLInputElement;
  inputEl.value = question;
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();

  const sendBtn = host.querySelector('button.btn-primary') as HTMLButtonElement;
  sendBtn.click();
  flushSync();

  // send() awaits fetch() then res.json(); let both promise chains drain, with
  // a macrotask flush in between so any queued reactions run, then re-render.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

describe('Chatbot server-status handling', () => {
  it('shows a distinct limit message for a 503, not the generic chat_error', async () => {
    const serverError = 'The chatbot has reached today\u2019s usage limit. Please try again tomorrow.';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(503, false, { ok: false, error: serverError }))
    );

    render();
    await ask('How much was collected in 2024?');

    const text = host.textContent || '';
    // The real reason must surface: either the server's error string or, if the
    // component fell back, the localized chat_limit — but NEVER the generic error.
    const surfaced = text.includes(serverError) || text.includes(T.en.chat_limit);
    expect(surfaced, 'a 503 must surface the limit/busy reason').toBe(true);
    expect(text).not.toContain(T.en.chat_error);
  });

  it('renders a clickable anchor for a 200 answer containing a URL (PR#406 guard)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse(200, true, { ok: true, answer: 'See <https://host.example.com/doc.pdf>' })
      )
    );

    render();
    await ask('Where is the receipt?');

    const anchor = host.querySelector('a[href^="https://"]') as HTMLAnchorElement | null;
    expect(anchor, 'a 200 answer with a URL must render a real anchor').toBeTruthy();
    expect(anchor!.getAttribute('href')).toBe('https://host.example.com/doc.pdf');
    expect(anchor!.getAttribute('target')).toBe('_blank');
    expect(anchor!.getAttribute('rel') || '').toContain('noopener');
  });
});
