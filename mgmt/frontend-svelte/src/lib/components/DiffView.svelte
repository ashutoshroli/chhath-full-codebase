<script lang="ts">
  // Ported from React DiffView.jsx — renders a unified diff with per-line color
  // coding (added/removed/hunk/meta).
  interface Props {
    diff: string;
  }
  let { diff }: Props = $props();

  function lineStyle(line: string): string {
    if (line.startsWith('+++') || line.startsWith('---')) return 'color:#6b7280; font-weight:600;';
    if (line.startsWith('@@')) return 'color:#8250df; background:#f6f0ff;';
    if (line.startsWith('diff ') || line.startsWith('index ')) return 'color:#6b7280;';
    if (line.startsWith('+')) return 'color:#116329; background:#e6ffec;';
    if (line.startsWith('-')) return 'color:#82071e; background:#ffebe9;';
    return 'color:#24292f;';
  }

  let text = $derived((diff || '').toString());
  let lines = $derived(text.split('\n'));
</script>

{#if !text.trim()}
  <div style="color:var(--text-muted); font-size:0.8rem;">No diff to show.</div>
{:else}
  <pre style="margin:0; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:0; font-size:0.72rem; line-height:1.5; overflow-x:auto; max-height:420px; overflow-y:auto; font-family:ui-monospace, SFMono-Regular, Menlo, monospace;">{#each lines as line, i (i)}<div style="{lineStyle(line)} padding:0 10px; white-space:pre;">{line || ' '}</div>{/each}</pre>
{/if}
