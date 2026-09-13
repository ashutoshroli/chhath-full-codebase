/**
 * Cross-skin UI state that lives above the skins (so the root layout owns the
 * single ThemeGallery instance while any skin's header can open it).
 */
import { writable } from 'svelte/store';

export const themeGalleryOpen = writable(false);

export function openThemeGallery() {
  themeGalleryOpen.set(true);
}
export function closeThemeGallery() {
  themeGalleryOpen.set(false);
}
