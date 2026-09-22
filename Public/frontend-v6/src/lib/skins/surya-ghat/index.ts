import type { Skin } from '../types';
import Shell from './SuryaShell.svelte';
import Home from './pages/Home.svelte';
import Expenses from './pages/Expenses.svelte';
import Loans from './pages/Loans.svelte';
import Committee from './pages/Committee.svelte';
import Downloads from './pages/Downloads.svelte';
import Decade from './pages/Decade.svelte';
import Donate from './pages/Donate.svelte';
import Verify from './pages/Verify.svelte';

export const suryaGhatSkin: Skin = {
  id: 'surya-ghat',
  Shell,
  pages: { Home, Expenses, Loans, Committee, Downloads, Decade, Donate, Verify }
};
