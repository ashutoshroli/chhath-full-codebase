<script lang="ts">
  import '$lib/styles.css';
  import { onMount } from 'svelte';
  import { reportClientError, isIgnorableClientError } from '$lib/api';

  let { children } = $props();

  // Global error reporting — mirrors React main.jsx window handlers.
  onMount(() => {
    const onError = (e: ErrorEvent) => {
      if (isIgnorableClientError(e.message)) return;
      if ((e.filename || '').includes('/_vercel/insights/')) return;
      const isOpaque = e.message === 'Script error.' && !e.error;
      reportClientError(
        'window.onerror',
        isOpaque
          ? 'Opaque cross-origin script error (no stack available)'
          : e.message,
        e.error,
        { filename: e.filename || '', lineno: e.lineno || 0, colno: e.colno || 0 }
      );
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const err = e.reason;
      const msg = (err && err.message) || String(err);
      if (isIgnorableClientError(msg)) return;
      reportClientError('window.unhandledrejection', msg, err, {});
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  });
</script>

{@render children()}
