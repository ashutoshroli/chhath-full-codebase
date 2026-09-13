import type { Skin } from '../types';
import Shell from './Shell.svelte';
import Home from './pages/Home.svelte';
import Expenses from './pages/Expenses.svelte';
import Loans from './pages/Loans.svelte';
import Committee from './pages/Committee.svelte';
import Downloads from './pages/Downloads.svelte';
import Decade from './pages/Decade.svelte';

export const auroraSkin: Skin = {
  id: 'aurora',
  Shell,
  pages: { Home, Expenses, Loans, Committee, Downloads, Decade }
};
