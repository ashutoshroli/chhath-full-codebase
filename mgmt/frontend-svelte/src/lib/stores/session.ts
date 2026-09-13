/**
 * Session store — mirrors the React App's `user` state. Holds the logged-in
 * { name, role } or null. On load it reads the persisted session (api.getSession).
 */
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getSession, clearSession, type SessionUser } from '$lib/api';

function createSession() {
  const initial: SessionUser | null = browser ? (getSession()?.user ?? null) : null;
  const { subscribe, set } = writable<SessionUser | null>(initial);

  return {
    subscribe,
    /** Set after a successful login / 2FA. */
    login(user: SessionUser) {
      set(user);
    },
    /** Clear local session state (does NOT call the logout API). */
    clear() {
      clearSession();
      set(null);
    }
  };
}

export const session = createSession();
