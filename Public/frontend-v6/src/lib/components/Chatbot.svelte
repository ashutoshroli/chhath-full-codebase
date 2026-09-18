<script lang="ts">
  /**
   * Floating chat assistant. Talks to the SAME Render.com endpoint the existing
   * portals use (config.renderChatUrl), POST { question, sessionId, lang }.
   * Purely additive; failures degrade to an inline error message.
   */
  import { MessageCircle, X, Send, Loader2 } from '@lucide/svelte';
  import { dialog } from '$lib/a11y/dialog'; // audit PR-36
  import { chatUrl } from '$lib/api/client';
  import { lang, tr } from '$lib/stores/lang';
  import { browser } from '$app/environment';
  import { untrack } from 'svelte';
  import { linkifyTokens } from '$lib/chat/linkify';

  interface Msg {
    role: 'user' | 'bot';
    text: string;
  }

  // Test seam: a jsdom component test can seed the transcript and open state
  // without driving the network. Defaults keep production behaviour identical.
  let { open: openInit = false, seedMessages = [] as Msg[] } = $props();

  let open = $state(untrack(() => openInit));
  let input = $state('');
  let sending = $state(false);
  /** Hard deadline for one chat round-trip (audit PUB-FE-01). */
  const CHAT_TIMEOUT_MS = 30_000;
  let messages = $state<Msg[]>(untrack(() => [...seedMessages]));
  let listEl: HTMLDivElement | undefined = $state();
  let welcomed = untrack(() => seedMessages.length > 0);

  // On first open, greet the visitor with a welcome message so the chat is never
  // empty. Localized via $tr; seeded once per mount.
  $effect(() => {
    if (open && !welcomed) {
      welcomed = true;
      if (messages.length === 0) {
        messages = [{ role: 'bot', text: $tr('chat_welcome') }];
        scrollSoon();
      }
    }
  });

  function sessionId(): string {
    if (!browser) return 'cs-ssr';
    try {
      let id = sessionStorage.getItem('chat_sid');
      if (!id) {
        id = 'cs-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem('chat_sid', id);
      }
      return id;
    } catch {
      return 'cs-' + Math.random().toString(36).slice(2);
    }
  }

  async function send() {
    const q = input.trim();
    if (!q || sending) return;
    messages = [...messages, { role: 'user', text: q }];
    input = '';
    sending = true;
    scrollSoon();
    // audit PUB-FE-01: this fetch had no deadline, so a connection that accepts
    // and then stalls left the panel stuck on "sending" with no way out except a
    // reload. The chat service answers in a second or two; 30s is generous.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    try {
      const res = await fetch(chatUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, sessionId: sessionId(), lang: $lang })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok && data.answer) {
        messages = [...messages, { role: 'bot', text: String(data.answer) }];
      } else {
        messages = [...messages, { role: 'bot', text: $tr('chat_error') }];
      }
    } catch {
      messages = [...messages, { role: 'bot', text: $tr('chat_error') }];
    } finally {
      clearTimeout(timer);
      sending = false;
      scrollSoon();
    }
  }

  function scrollSoon() {
    setTimeout(() => listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' }), 40);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<!-- Launcher — a layered "3D" orb on the modern/gen-z themes (see .chat-orb in
  app.css), a clean flat circle on the classic/enterprise themes. The markup is
  the same everywhere; CSS decides the look per [data-theme]. -->
<button
  class="chat-orb fixed bottom-20 right-4 z-50 grid h-14 w-14 place-items-center rounded-full
    text-white transition active:scale-95 md:bottom-6"
  class:chat-orb--open={open}
  onclick={() => (open = !open)}
  aria-label={$tr('ask_assistant')}
  aria-expanded={open}
>
  <span class="chat-orb__gloss" aria-hidden="true"></span>
  <span class="chat-orb__icon relative">
    {#if open}
      <X class="h-6 w-6" aria-hidden="true" />
    {:else}
      <MessageCircle class="h-6 w-6" aria-hidden="true" />
    {/if}
  </span>
</button>

{#if open}
  <div
    class="surface chat-panel fixed bottom-36 right-4 z-50 flex h-[26rem] w-[min(22rem,calc(100vw-2rem))]
      flex-col overflow-hidden md:bottom-24"
    role="dialog"
    aria-label={$tr('ask_assistant')}
    tabindex="-1"
    use:dialog={{ onclose: () => (open = false), modal: false }}
  >
    <div class="chat-panel__header flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
      <span class="chat-orb chat-orb--mini grid h-8 w-8 place-items-center rounded-full text-white">
        <span class="chat-orb__gloss" aria-hidden="true"></span>
        <MessageCircle class="chat-orb__icon relative h-4 w-4" />
      </span>
      <span class="text-sm font-bold">{$tr('ask_assistant')}</span>
    </div>

    <!-- audit PR-40: the transcript is a log, and the assistant's replies arrive
         asynchronously. Without role="log" nothing announced them, so a screen-reader user
         asked a question and then sat in silence with no way to know an answer had appeared.
         `role="log"` is the right choice over `role="status"`: it means "new items are
         appended", so only the ADDITION is read out, not the whole conversation again.
         aria-busy tells the user the reply is still coming rather than lost. -->
    <div
      bind:this={listEl}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-busy={sending}
      aria-label={$tr('ask_assistant')}
      class="flex-1 space-y-2 overflow-y-auto p-3"
    >
      <!-- audit PUB-FE-02: bot replies were rendered as plain `{m.text}`, so URLs
           from the chat endpoint (`data.answer`, UNTRUSTED external content) were
           not clickable, markdown autolink `<https://...>` showed its literal
           angle brackets, and a long unbroken URL blew past `max-w-[80%]` and
           spilled outside the bubble/panel because `whitespace-pre-wrap` does not
           break unbroken strings. Fix: linkifyTokens() turns the reply into
           text/link tokens — text renders via `{tok.value}` (Svelte escapes) and
           links via a real <a> (Svelte escapes the href), so NO {@html} touches
           raw external text and only validated http(s) URLs become anchors.
           `break-words`/overflow-wrap makes long URLs wrap inside the bubble. -->
      {#each messages as m}
        <div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
          <div
            class="max-w-[80%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm
              {m.role === 'user'
              ? 'bg-brand-500 text-white'
              : 'bg-black/5 text-slate-800 dark:bg-white/10 dark:text-slate-100'}"
          >
            {#if m.role === 'bot'}
              {#each linkifyTokens(m.text) as tok}
                {#if tok.type === 'link'}<a
                    href={tok.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    class="font-medium underline break-words [overflow-wrap:anywhere] text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
                    >{tok.label}</a
                  >{:else}{tok.value}{/if}
              {/each}
            {:else}{m.text}{/if}
          </div>
        </div>
      {/each}
      {#if sending}
        <div class="flex justify-start">
          <div class="rounded-2xl bg-black/5 px-3 py-2 dark:bg-white/10">
            <Loader2 class="h-4 w-4 animate-spin text-slate-500" />
          </div>
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-2 border-t border-black/5 p-2 dark:border-white/10">
      <input
        class="flex-1 rounded-xl bg-black/5 px-3 py-2 text-sm outline-none dark:bg-white/10"
        placeholder={$tr('chat_placeholder')}
        bind:value={input}
        onkeydown={onKey}
        aria-label={$tr('chat_placeholder')}
      />
      <button class="btn-primary !px-3 !py-2" onclick={send} disabled={sending} aria-label={$tr('send')}>
        <Send class="h-4 w-4" />
      </button>
    </div>
  </div>
{/if}
