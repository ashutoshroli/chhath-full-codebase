<script lang="ts">
  import { page } from '$app/stores';
  import { NAV_ITEMS } from './nav';
  import { tr } from '$lib/stores/lang';

  const isActive = (href: string, path: string) =>
    href === '/' ? path === '/' : path.startsWith(href);
</script>

<!-- Mobile bottom navigation (hidden on md+). Anchored to the viewport. -->
<nav
  class="fixed inset-x-0 bottom-0 z-40 md:hidden
    bg-white/90 backdrop-blur-lg border-t border-black/5
    dark:bg-ink/90 dark:border-white/10"
  style="padding-bottom: env(safe-area-inset-bottom);"
  aria-label="Primary"
>
  <ul class="mx-auto flex max-w-lg items-stretch justify-around">
    {#each NAV_ITEMS as item}
      {@const active = isActive(item.href, $page.url.pathname)}
      {@const Icon = item.icon}
      <li class="flex-1">
        <a
          href={item.href}
          aria-current={active ? 'page' : undefined}
          class="flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition
            {active ? 'text-brand-500' : 'text-slate-500 dark:text-slate-400'}"
        >
          <span
            class="grid h-9 w-12 place-items-center rounded-xl transition
              {active ? 'bg-brand-500/10 dark:bg-brand-500/20' : ''}"
          >
            <Icon class="h-5 w-5" aria-hidden="true" />
          </span>
          {$tr(item.key)}
        </a>
      </li>
    {/each}
  </ul>
</nav>
