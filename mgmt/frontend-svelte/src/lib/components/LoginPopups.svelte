<script lang="ts">
  // Ported from React LoginPopups.jsx — after a fresh login, shows the active
  // popups (each with auto-advancing slides) in a modal, one popup at a time.
  import { api } from '$lib/api';
  import Modal from './Modal.svelte';
  import { driveImageUrl, driveImgOnError } from '$lib/driveUrl';

  const DEFAULT_DURATION_MS = 5000;
  function clampDurationMs(ms: unknown): number {
    const n = parseInt(ms as string, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MS;
    if (n < 1000) return 1000;
    if (n > 60000) return 60000;
    return n;
  }

  let popups = $state<any[] | null>(null);
  let popupIndex = $state(0);
  let slideIndex = $state(0);
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    api.getActivePopups().then((p: any) => (popups = p)).catch(() => (popups = []));
  });

  let valid = $derived(!!(popups && popups.length > 0 && popupIndex < popups.length));
  let popup = $derived(valid ? popups![popupIndex] : null);
  let slideCount = $derived(popup ? popup.slides.length : 0);

  $effect(() => {
    void slideIndex;
    void slideCount;
    void popupIndex;
    if (!popup || slideCount <= 1 || paused) return;
    const ms = clampDurationMs(popup.slides[slideIndex] && popup.slides[slideIndex].duration_ms);
    timer = setTimeout(() => {
      slideIndex = (slideIndex + 1) % slideCount;
    }, ms);
    return () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
  });

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  let slide = $derived(valid ? popup.slides[slideIndex] : null);
  let isLastSlide = $derived(slideIndex === slideCount - 1);
  let isLastPopup = $derived(!!(popups && popupIndex === popups.length - 1));

  function goNextPopup() {
    clearTimer();
    if (isLastPopup) {
      popups = [];
    } else {
      popupIndex = popupIndex + 1;
      slideIndex = 0;
    }
  }

  function next() {
    if (!isLastSlide) slideIndex = slideIndex + 1;
    else goNextPopup();
  }
</script>

{#if valid && slide}
  <Modal open={true} onClose={goNextPopup} title="Notice">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      style="text-align:center;"
      onmouseenter={() => { paused = true; clearTimer(); }}
      onmouseleave={() => { paused = false; slideIndex = slideIndex; }}
    >
      {#if slide.image_url}
        <img
          src={driveImageUrl(slide.image_url)}
          alt=""
          style="max-width:100%; max-height:320px; border-radius:10px; margin-bottom:15px;"
          onerror={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (img.dataset.driveFallbackTried !== '1') {
              driveImgOnError(slide.image_url)(e);
              if (img.dataset.driveFallbackTried === '1') return;
            }
            img.style.display = 'none';
          }}
        />
      {/if}
      {#if slide.text}
        <p style="font-size:0.95rem; white-space:pre-wrap; margin-bottom:12px;">{slide.text}</p>
      {/if}
      {#if slide.link_url}
        <a href={slide.link_url} target="_blank" rel="noreferrer" style="display:inline-block; color:var(--primary-saffron); font-weight:600; margin-bottom:15px; text-decoration:underline;">
          {slide.link_text || slide.link_url}
        </a>
      {/if}

      {#if slideCount > 1}
        <div style="display:flex; justify-content:center; gap:6px; margin:10px 0;">
          {#each popup.slides as _, i (i)}
            <span style="width:8px; height:8px; border-radius:50%; background:{i === slideIndex ? 'var(--primary-saffron)' : '#e5e7eb'};"></span>
          {/each}
        </div>
      {/if}

      <div style="display:flex; gap:10px; justify-content:center; margin-top:15px;">
        <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={goNextPopup}>
          Skip
        </button>
        <button class="btn-submit" style="width:auto;" onclick={next}>
          {isLastSlide ? (isLastPopup ? 'Done' : 'Next Announcement') : 'Next'}
        </button>
      </div>
    </div>
  </Modal>
{/if}
