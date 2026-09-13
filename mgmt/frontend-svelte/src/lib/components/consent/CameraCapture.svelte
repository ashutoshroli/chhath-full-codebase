<script lang="ts">
  // Ported from the CameraCapture sub-component of React views/ConsentPage.jsx —
  // opens the front camera, captures a JPEG frame, and returns base64 (or null
  // to retake). Stops the stream on teardown.
  interface Props {
    photo: string | null;
    onCapture: (b64: string | null) => void;
  }
  let { photo, onCapture }: Props = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | null = null;
  let camState = $state<'idle' | 'starting' | 'live' | 'denied'>('idle');

  async function startCamera() {
    camState = 'starting';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoEl) { videoEl.srcObject = stream; await videoEl.play(); }
      camState = 'live';
    } catch (err) {
      camState = 'denied';
    }
  }

  function capture() {
    const video = videoEl;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    stopCamera();
    onCapture(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    camState = 'idle';
  }

  $effect(() => () => stopCamera());
</script>

{#if photo}
  <div>
    <img src={`data:image/jpeg;base64,${photo}`} alt="Captured" style="width:100%; border-radius:8px; margin-bottom:8px;" />
    <button type="button" class="btn-submit" style="background:#e5e7eb; color:#111;" onclick={() => onCapture(null)}>Retake Photo</button>
  </div>
{:else}
  <div>
    <video
      bind:this={videoEl}
      style="width:100%; border-radius:8px; margin-bottom:8px; transform:scaleX(-1); display:{camState === 'live' ? 'block' : 'none'};"
      muted
      playsinline
    ></video>
    {#if camState === 'live'}
      <button type="button" class="btn-submit" onclick={capture}>📸 Capture Photo</button>
    {:else}
      <button type="button" class="btn-submit" onclick={startCamera} disabled={camState === 'starting'}>
        {camState === 'starting' ? 'Opening camera...' : '📷 Open Camera'}
      </button>
    {/if}
    {#if camState === 'denied'}
      <p style="color:var(--danger); font-size:0.8rem; margin-top:6px;">
        Camera permission was denied. Please allow camera access in your browser settings and try again — a photo is required to Accept.
      </p>
    {/if}
  </div>
{/if}
