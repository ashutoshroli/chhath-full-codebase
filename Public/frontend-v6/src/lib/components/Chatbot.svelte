<script lang="ts">
  /**
   * Floating chat assistant. Talks to the SAME Render.com endpoint the existing
   * portals use (config.renderChatUrl), POST { question, sessionId, lang }.
   * Purely additive; failures degrade to an inline error message.
   */
  import { MessageCircle, X, Send, Loader2 } from '@lucide/svelte';
  import { chatUrl } from '$lib/api/client';
  import { lang, tr } from '$lib/stores/lang';
  import { browser } from '$app/environment';

  interface Msg {
    role: 'user' | 'bot';
    text: string;
  }

  let open = $state(false);
  let input = $state('');
  let sending = $state(false);
  let messages = $state<Msg[]>([]);
  let listEl: HTMLDivElement | undefined = $state();

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
    try {
      const res = await fetch(chatUrl, {
        method: 'POST',
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

<!-- Launcher -->
<button
  class="fixed bottom-20 right-4 z-50 grid place-items-center rounded-full
    bg-gradient-to-br from-brand-500 to-brand-600 p-3.5 text-white shadow-glow
    transition active:scale-95 md:bottom-6"
  onclick={() => (open = !open)}
  aria-label={$tr('ask_assistant')}
  aria-expanded={open}
>
  {#if open}
    <X class="h-6 w-6" aria-hidden="true" />
  {:else}
    <MessageCircle class="h-6 w-6" aria-hidden="true" />
  {/if}
</button>

{#if open}
  <div
    class="surface fixed bottom-36 right-4 z-50 flex h-[26rem] w-[min(22rem,calc(100vw-2rem))]
      flex-col overflow-hidden md:bottom-24"
    role="dialog"
    aria-label={$tr('ask_assistant')}
  >
    <div class="flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
      <span class="grid h-7 w-7 place-items-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300">
        <MessageCircle class="h-4 w-4" />
      </span>
      <span class="text-sm font-bold">{$tr('ask_assistant')}</span>
    </div>

    <div bind:this={listEl} class="flex-1 space-y-2 overflow-y-auto p-3">
      {#each messages as m}
        <div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
          <div
            class="max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm
              {m.role === 'user'
              ? 'bg-brand-500 text-white'
              : 'bg-black/5 text-slate-800 dark:bg-white/10 dark:text-slate-100'}"
          >
            {m.text}
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
