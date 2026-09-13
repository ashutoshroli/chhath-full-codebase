<script lang="ts">
  interface Props {
    rows?: number;
  }
  let { rows = 6 }: Props = $props();
</script>

<div class="space-y-2.5">
  {#each Array(rows) as _}
    <div class="surface flex items-center gap-3 p-3">
      <div class="skeleton h-10 w-10 rounded-full"></div>
      <div class="flex-1 space-y-2">
        <div class="skeleton h-3.5 w-1/3"></div>
        <div class="skeleton h-3 w-1/2"></div>
      </div>
      <div class="skeleton h-5 w-16"></div>
    </div>
  {/each}
</div>
