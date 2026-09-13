// Fully static site: prerender everything, no SSR runtime needed on the host.
// Client-side navigation handles the interactive dashboard after first load.
export const prerender = true;
export const ssr = true;
export const trailingSlash = 'ignore';
