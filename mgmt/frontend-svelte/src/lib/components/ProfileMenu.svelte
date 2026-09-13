<script lang="ts">
  // Ported from React ProfileMenu.jsx — header account button with a dropdown
  // (name/role, Settings, Logout); closes on outside click.
  interface Props {
    name: string;
    role: string;
    onOpenSettings: () => void;
    onLogout: () => void;
  }
  let { name, role, onOpenSettings, onLogout }: Props = $props();

  let open = $state(false);
  let ref: HTMLDivElement | undefined = $state();

  $effect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref && !ref.contains(e.target as Node)) open = false;
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  });
</script>

<div bind:this={ref} style="position:relative;">
  <button
    class="nav-btn"
    style="width:auto; display:flex; align-items:center; gap:4px;"
    onclick={() => (open = !open)}
  >
    <span class="material-icons-round">account_circle</span>
  </button>

  {#if open}
    <div class="glass-card" style="position:absolute; right:0; top:110%; min-width:190px; padding:8px; z-index:100;">
      <div style="padding:8px 10px; margin-bottom:6px; border-bottom:1px solid #e5e7eb;">
        <strong style="display:block; font-size:0.95rem;">{name}</strong>
        <span style="font-size:0.75rem; color:var(--text-muted);">{role}</span>
      </div>
      <button class="nav-btn" style="width:100%; justify-content:flex-start; gap:8px;" onclick={() => { open = false; onOpenSettings(); }}>
        <span class="material-icons-round">settings</span> Settings
      </button>
      <button class="nav-btn" style="width:100%; justify-content:flex-start; gap:8px; color:var(--danger);" onclick={() => { open = false; onLogout(); }}>
        <span class="material-icons-round">logout</span> Logout
      </button>
    </div>
  {/if}
</div>
