<script lang="ts">
  /**
   * Public User Guide (/guide) — skin-agnostic page (like privacy/terms): renders
   * inside the active skin's Shell. Explains every feature, previews all themes
   * (tap to apply), and states the bug-testing / responsible-disclosure policy.
   */
  import {
    BookOpen, Users, Landmark, Download, Palette, Languages, Calendar,
    MessageCircle, ShieldAlert, Mail, LayoutGrid, HeartHandshake, Smartphone,
    Share, MonitorDown, Bell
  } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import ThemePreviewCard from '$lib/components/ThemePreviewCard.svelte';
  import InstallButton from '$lib/components/InstallButton.svelte';
  import NotifyButton from '$lib/components/NotifyButton.svelte';
  import AgeRatings from '$lib/components/AgeRatings.svelte';
  import { tr } from '$lib/stores/lang';
  import { THEMES } from '$lib/themes';
  import { themeId } from '$lib/stores/theme';

  const BUG_EMAIL = 'chhath@shaharpura.com';

  // Core-feature cards: [icon, title key, body key].
  const FEATURES = [
    [LayoutGrid, 'guide_nav_h', 'guide_nav_p'],
    [Users, 'guide_contributors_h', 'guide_contributors_p'],
    [Landmark, 'guide_loans_h', 'guide_loans_p'],
    [Users, 'guide_committee_h', 'guide_committee_p'],
    [Download, 'guide_downloads_h', 'guide_downloads_p'],
    [HeartHandshake, 'guide_donate_h', 'guide_donate_p'],
    [Palette, 'guide_theme_h', 'guide_theme_p'],
    [Languages, 'guide_language_h', 'guide_language_p'],
    [Calendar, 'guide_year_h', 'guide_year_p'],
    [MessageCircle, 'guide_chatbot_h', 'guide_chatbot_p']
  ] as const;

  // PWA install steps: [icon, heading key, body key].
  const INSTALL_STEPS = [
    [Smartphone, 'guide_install_android_h', 'guide_install_android_p'],
    [Share, 'guide_install_ios_h', 'guide_install_ios_p'],
    [MonitorDown, 'guide_install_desktop_h', 'guide_install_desktop_p']
  ] as const;
</script>

<svelte:head>
  <title>{$tr('guide_title')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={BookOpen} titleKey="guide_title" subtitle={$tr('guide_subtitle')} />

<p class="mb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{$tr('guide_intro')}</p>

<!-- Core features -->
<h2 class="mb-3 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">{$tr('guide_features_h')}</h2>
<div class="grid gap-3 sm:grid-cols-2">
  {#each FEATURES as [Icon, titleKey, bodyKey]}
    <div class="surface flex gap-3 p-4">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300">
        <Icon class="h-5 w-5" aria-hidden="true" />
      </span>
      <div class="min-w-0">
        <h3 class="text-sm font-black text-slate-900 dark:text-white">{$tr(titleKey)}</h3>
        <p class="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{$tr(bodyKey)}</p>
      </div>
    </div>
  {/each}
</div>

<!-- Theme gallery -->
<h2 class="mb-1 mt-8 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">{$tr('guide_gallery_h')}</h2>
<p class="mb-3 text-sm text-slate-600 dark:text-slate-300">{$tr('guide_gallery_p')}</p>
<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
  {#each THEMES as theme (theme.id)}
    <ThemePreviewCard {theme} active={$themeId === theme.id} />
  {/each}
</div>

<!-- Install the app (PWA) -->
<section class="surface mt-8 p-5">
  <h2 class="flex items-center gap-2 text-base font-black text-slate-900 dark:text-white">
    <Download class="h-5 w-5 text-brand-500" aria-hidden="true" />
    {$tr('guide_install_h')}
  </h2>
  <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{$tr('guide_install_p')}</p>
  <div class="mt-3">
    <InstallButton />
  </div>
  <div class="mt-4 grid gap-3 sm:grid-cols-3">
    {#each INSTALL_STEPS as [Icon, h, p]}
      <div class="rounded-xl border border-black/10 p-4 dark:border-white/10">
        <h3 class="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
          <Icon class="h-4 w-4 text-brand-500" aria-hidden="true" />
          {$tr(h)}
        </h3>
        <p class="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{$tr(p)}</p>
      </div>
    {/each}
  </div>
</section>

<!-- Notifications opt-in (renders nothing when push is unavailable/unconfigured) -->
<section class="surface mt-8 p-5">
  <h2 class="flex items-center gap-2 text-base font-black text-slate-900 dark:text-white">
    <Bell class="h-5 w-5 text-brand-500" aria-hidden="true" />
    {$tr('notify_h')}
  </h2>
  <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{$tr('notify_p')}</p>
  <div class="mt-3">
    <NotifyButton />
  </div>
  <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">{$tr('notify_ios_note')}</p>
</section>

<!-- Age ratings (IARC) — same certificate the PWA manifest advertises -->
<AgeRatings />

<!-- Bug testing / responsible disclosure -->
<section class="surface mt-8 border-l-4 border-amber-500 p-5">
  <h2 class="flex items-center gap-2 text-base font-black text-slate-900 dark:text-white">
    <ShieldAlert class="h-5 w-5 text-amber-500" aria-hidden="true" />
    {$tr('guide_bug_h')}
  </h2>
  <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{$tr('guide_bug_intro')}</p>

  <div class="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4">
    <h3 class="text-sm font-black text-danger">{$tr('guide_bug_high_h')}</h3>
    <p class="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{$tr('guide_bug_high_p')}</p>
  </div>

  <div class="mt-3 rounded-xl border border-success/30 bg-success/5 p-4">
    <h3 class="text-sm font-black text-success">{$tr('guide_bug_low_h')}</h3>
    <p class="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{$tr('guide_bug_low_p')}</p>
  </div>

  <a
    href="mailto:{BUG_EMAIL}"
    class="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600 active:scale-95"
  >
    <Mail class="h-4 w-4" aria-hidden="true" />
    {$tr('guide_bug_email_label')} · {BUG_EMAIL}
  </a>
</section>
