<script lang="ts">
  // Ported from React PopupSlideshow.jsx — auto-playing slideshow (pauses on
  // hover) used by the PopupManagement live preview.
  import { driveImageUrl, driveImgOnError } from '$lib/driveUrl';

  interface Props {
    slides: any[];
  }
  let { slides }: Props = $props();

  const DEFAULT_DURATION_MS = 5000;
  function clampDurationMs(ms: unknown): number {
    const n = parseInt(ms as string, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MS;
    if (n < 1000) return 1000;
    if (n > 60000) return 60000;
    return n;
  }

  function norm(s: any) {
    return {
      imageUrl: s.image_url || s.imageUrl || '',
      text: s.text || '',
      linkUrl: s.link_url || s.linkUrl || '',
      linkText: s.link_text || s.linkText || '',
      durationMs: clampDurationMs(s.duration_ms != null ? s.duration_ms : s.durationMs)
    };
  }

  function isHttpUrl(u: string): boolean {
    try {
      const parsed = new URL(u, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  let list = $derived((slides || []).map(norm));
  let count = $derived(list.length);
  let index = $state(0);
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  let safeIndex = $derived(count ? Math.min(index, count - 1) : 0);
  let slide = $derived(count ? list[safeIndex] : null);

  $effect(() => {
    // depend on safeIndex + count (matches React deps)
    void safeIndex;
    void count;
    if (count <= 1) return;
    if (paused) return;
    const ms = list[safeIndex] ? list[safeIndex].durationMs : DEFAULT_DURATION_MS;
    timer = setTimeout(() => {
      index = (index + 1) % count;
    }, ms);
    return () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
  });

  function pause() {
    paused = true;
    if (timer) { clearTimeout(timer); timer = null; }
  }
  function resume() {
    paused = false;
    index = index; // re-trigger the effect
  }
  function prev() { pause(); index = (index - 1 + count) % count; paused = false; }
  function next() { pause(); index = (index + 1) % count; paused = false; }
</script>

{#if !count}
  <div style="padding:20px; text-align:center; color:var(--text-muted);">No slides to preview.</div>
{:else if slide}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    onmouseenter={pause}
    onmouseleave={resume}
    style="background:#fff; border-radius:14px; max-width:420px; width:100%; margin:0 auto; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,0.25);"
  >
    {#if slide.imageUrl && isHttpUrl(driveImageUrl(slide.imageUrl))}
      <img
        src={driveImageUrl(slide.imageUrl)}
        alt=""
        style="width:100%; height:auto; display:block; background:#f3f4f6;"
        onerror={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (img.dataset.driveFallbackTried !== '1') {
            driveImgOnError(slide.imageUrl)(e);
            if (img.dataset.driveFallbackTried === '1') return;
          }
          img.style.display = 'none';
        }}
      />
    {/if}
    {#if slide.text}
      <div style="padding:16px; font-size:0.9rem; color:#333; white-space:pre-wrap; overflow-wrap:anywhere;">
        {slide.text}
      </div>
    {/if}
    {#if slide.linkUrl && isHttpUrl(slide.linkUrl)}
      <a
        href={slide.linkUrl}
        target="_blank"
        rel="noreferrer"
        style="display:inline-block; margin:0 16px 16px; padding:8px 16px; border-radius:8px; background:var(--primary-saffron); color:#fff; text-decoration:none; font-weight:600; font-size:0.85rem; overflow-wrap:anywhere;"
      >
        {slide.linkText || 'Learn more'}
      </a>
    {/if}
    {#if count > 1}
      <div style="display:flex; align-items:center; justify-content:center; gap:14px; padding:0 0 12px;">
        <button type="button" onclick={prev} aria-label="Previous" style="background:none; border:1px solid #ddd; border-radius:50%; width:32px; height:32px; font-size:1.1rem; cursor:pointer; color:var(--primary-saffron);">&#8249;</button>
        <span style="font-size:0.75rem; color:var(--text-muted);">{safeIndex + 1} / {count}</span>
        <button type="button" onclick={next} aria-label="Next" style="background:none; border:1px solid #ddd; border-radius:50%; width:32px; height:32px; font-size:1.1rem; cursor:pointer; color:var(--primary-saffron);">&#8250;</button>
      </div>
    {/if}
  </div>
{/if}
