<script lang="ts">
  /**
   * Announcement popup — shows the first eligible active popup from the backend
   * (?action=activePopups). Multi-slide carousel with auto-advance, prev/next,
   * dots, image (with Drive fallback), text and an optional link. Once dismissed
   * in a session it stays closed (sessionStorage), so it isn't nagging.
   */
  import { X, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { dialog } from '$lib/a11y/dialog'; // audit PR-36
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { loadActivePopups } from '$lib/api/client';
  import { activePopupsSchema, type Popup } from '$lib/api/schema';
  import { safeUrl } from '$lib/utils/format';
  import { driveImageUrl, driveImageFallbackUrl } from '$lib/utils/drive';

  let popup = $state<Popup | null>(null);
  let open = $state(false);
  let idx = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Show at most once per 24h (persisted in localStorage) — not every refresh,
  // and not just once per session. Dismissing also starts the 24h window.
  const SEEN_KEY = 'cpm_public_v4_popup_seen_at';
  const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, Date.now().toString());
    } catch {
      /* ignore */
    }
  }

  function seenRecently(): boolean {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      if (!raw) return false;
      const t = parseInt(raw, 10);
      if (!Number.isFinite(t)) return false;
      return Date.now() - t < SEEN_TTL_MS;
    } catch {
      return false;
    }
  }

  function clampDuration(ms: unknown): number {
    const n = parseInt((ms ?? '').toString(), 10);
    if (!Number.isFinite(n) || n <= 0) return 5000;
    return Math.min(60000, Math.max(1000, n));
  }

  function pickFirst(popups: Popup[]): Popup | null {
    const first = popups?.[0];
    if (!first || !Array.isArray(first.slides) || first.slides.length === 0) return null;
    return first;
  }

  let slides = $derived(popup?.slides ?? []);

  function scheduleNext() {
    clearTimeout(timer);
    if (!open || slides.length <= 1) return;
    const dur = clampDuration(slides[idx]?.duration_ms);
    timer = setTimeout(() => (idx = (idx + 1) % slides.length), dur);
  }

  $effect(() => {
    // re-arm the auto-advance whenever the slide index / open state changes
    void idx;
    void open;
    scheduleNext();
    return () => clearTimeout(timer);
  });

  function close() {
    open = false;
    clearTimeout(timer);
    markSeen();
  }

  onMount(async () => {
    if (!browser) return;
    // Skip if it was already shown within the last 24 hours.
    if (seenRecently()) return;
    const raw = await loadActivePopups();
    const parsed = activePopupsSchema.safeParse(raw);
    const list = parsed.success ? parsed.data : [];
    const p = pickFirst(list as Popup[]);
    if (p) {
      popup = p;
      idx = 0;
      open = true;
      // Mark as seen as soon as it is shown, so a refresh within 24h won't
      // re-open it even if the visitor doesn't explicitly dismiss.
      markSeen();
    }
  });

  function go(dir: 1 | -1) {
    idx = (idx + dir + slides.length) % slides.length;
  }

  // Escape now belongs to `use:dialog`; the arrows stay here because they are this
  // component's own carousel controls. Bound to the dialog node rather than the window, so
  // they cannot fire for a popup that is not on screen.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  }
</script>

{#if open && slides.length > 0}
  {@const s = slides[idx]}
  {@const img = s.image_url ? driveImageUrl(s.image_url) : ''}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    onclick={close}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="surface relative w-full max-w-sm overflow-hidden rounded-3xl"
      role="dialog"
      aria-modal="true"
      aria-label={(popup?.title ?? 'Announcement').toString()}
      tabindex="-1"
      use:dialog={{ onclose: close }}
      onkeydown={onKey}
      onclick={(e) => e.stopPropagation()}
    >
      <button
        class="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
        onclick={close}
        aria-label="Close"
      >
        <X class="h-4 w-4" />
      </button>

      {#if s.image_url && safeUrl(img)}
        <img
          src={img}
          alt=""
          class="max-h-[55vh] w-full object-cover"
          data-fb={driveImageFallbackUrl(s.image_url)}
          onerror={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            const fb = el.dataset.fb;
            if (fb && el.dataset.fbTried !== '1') {
              el.dataset.fbTried = '1';
              el.src = fb;
            } else {
              el.style.display = 'none';
            }
          }}
        />
      {/if}

      <!-- popup.title is a Superadmin-only reference label (backend marks it
           "not shown to viewers") so it is intentionally NOT rendered. The text
           block only renders when a slide actually has text or a link, so an
           image-only announcement shows no empty padding strip. -->
      {#if s.text || (s.link_url && safeUrl(s.link_url.toString()))}
        <div class="p-4">
          {#if s.text}
            <p class="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{s.text}</p>
          {/if}
          {#if s.link_url && safeUrl(s.link_url.toString())}
            <a
              class="btn-primary mt-3 w-full"
              href={s.link_url.toString()}
              target="_blank"
              rel="noreferrer"
            >
              {s.link_text || 'Learn more'}
            </a>
          {/if}
        </div>
      {/if}

      {#if slides.length > 1}
        <div class="flex items-center justify-between border-t border-black/5 px-3 py-2 dark:border-white/10">
          <button class="chip !h-8 !px-2" onclick={() => go(-1)} aria-label="Previous">
            <ChevronLeft class="h-4 w-4" />
          </button>
          <div class="flex items-center gap-1.5">
            {#each slides as _, i}
              <span class="h-1.5 rounded-full transition-all {i === idx ? 'w-4 bg-brand-500' : 'w-1.5 bg-slate-300 dark:bg-white/25'}"></span>
            {/each}
          </div>
          <button class="chip !h-8 !px-2" onclick={() => go(1)} aria-label="Next">
            <ChevronRight class="h-4 w-4" />
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
