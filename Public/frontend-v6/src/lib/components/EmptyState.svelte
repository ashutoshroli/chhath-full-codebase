<script lang="ts">
  import { Inbox } from '@lucide/svelte';

  interface Props {
    message: string;
  }
  let { message }: Props = $props();
</script>

<div class="flex flex-col items-center gap-2 py-12 text-center text-slate-500 dark:text-slate-400">
  <span class="grid h-12 w-12 place-items-center rounded-full bg-black/5 dark:bg-white/10">
    <Inbox class="h-6 w-6" aria-hidden="true" />
  </span>
  <p class="text-sm font-medium">{message}</p>
</div>
