<script lang="ts">
  /**
   * Per-route canonical, social preview and structured data (audit PR-42).
   *
   * Rendered once from `+layout.svelte`, deriving everything from the current pathname, so all
   * twelve routes are covered without twelve copies of the same six tags — and a thirteenth
   * route gets them the moment it is added to `ROUTES`.
   *
   * The canonical is the point. `+layout.svelte` used to emit
   *   <link rel="canonical" href={config.siteUrl} />
   * on every page, which tells a crawler that /expenses, /loans, /committee and the rest are
   * duplicates of the home page. Every inner page of the portal was asking not to be indexed.
   */
  import { page } from '$app/stores';
  import { config } from '$lib/config';
  import { tr } from '$lib/stores/lang';
  import { canonicalFor, metaFor, organisationJsonLd, websiteJsonLd } from '$lib/seo';

  let path = $derived($page.url.pathname);
  let meta = $derived(metaFor(path));
  let canonical = $derived(canonicalFor(config.siteUrl, path));
  let title = $derived(
    meta ? (meta.path === '' ? $tr('app_title') : `${$tr(meta.titleKey)} — ${$tr('app_title')}`) : $tr('app_title')
  );
  // Social share title: the home route's document title is the bare app_title ('Chhath Puja'),
  // too weak a preview for a share card, so og:title/twitter:title use the fuller descriptive
  // `social_title` there. Inner routes already get `${pageTitle} — ${app_title}` and keep it.
  let socialTitle = $derived(meta && meta.path === '' ? $tr('social_title') : title);
  // A route with no entry in the table is not a page we want indexed — an unknown path under a
  // SPA fallback would otherwise be indexed as a copy of the home page.
  let indexable = $derived(!!meta);
  // Social preview image: the 1280x720 screenshot (>=1200x630 recommended) rather than the
  // 512-square app icon, paired with a summary_large_image card (twitter:card in app.html).
  const image = $derived(`${config.siteUrl.replace(/\/+$/, '')}/screenshots/wide.png`);
</script>

<svelte:head>
  <link rel="canonical" href={canonical} />
  <meta property="og:url" content={canonical} />
  <meta property="og:title" content={socialTitle} />
  <meta name="twitter:title" content={socialTitle} />
  {#if meta}
    <meta name="description" content={meta.description} />
    <meta property="og:description" content={meta.description} />
    <meta name="twitter:description" content={meta.description} />
  {/if}
  <meta property="og:image" content={image} />
  <meta name="twitter:image" content={image} />
  {#if !indexable}
    <meta name="robots" content="noindex, follow" />
  {/if}
  <!-- Structured data. Emitted once per page from the layout rather than per route: the two
       nodes describe the SITE and the ORGANISATION, neither of which varies by path. -->
  {@html `<script type="application/ld+json">${organisationJsonLd(config.siteUrl)}</script>`}
  {@html `<script type="application/ld+json">${websiteJsonLd(config.siteUrl)}</script>`}
</svelte:head>
