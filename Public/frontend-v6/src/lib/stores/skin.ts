import { derived } from 'svelte/store';
import { themeId } from './theme';
import { skinForTheme } from '$lib/skins/registry';
import type { Skin } from '$lib/skins/types';

/** The active full-portal skin, resolved from the selected theme. */
export const activeSkin = derived(themeId, ($id): Skin => skinForTheme($id));
