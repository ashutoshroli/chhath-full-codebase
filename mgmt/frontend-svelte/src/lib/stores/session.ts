/**
 * Session store — mirrors the React App's `user` state. Holds the logged-in
 * { name, role } or null. On load it reads the persisted session (api.getSession).
 *
 * audit P0-11: the API layer clears storage when the server rejects a session,
 * but nothing told THIS store, so the app stayed on the authenticated shell with
 * a user that no longer existed. The store now listens for that event and clears
 * itself, which is what returns the app to Login.
 */
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getSession, clearSession, onAuthExpired, resetAuthExpiredNotice, type SessionUser } from '$lib/api';

/** Why the session ended, so the UI can explain itself. */
export const sessionEndedMessage = writable<string>('');

function createSession() {
  const initial: SessionUser | null = browser ? (getSession()?.user ?? null) : null;
  const { subscribe, set } = writable<SessionUser | null>(initial);

  if (browser) {
    onAuthExpired((message) => {
      // clearSession() has already run inside the API layer (it also purges the
      // view cache — audit P0-08); this drops the in-memory user so the shell
      // unmounts and Login renders.
      sessionEndedMessage.set(message || 'Your session has expired. Please sign in again.');
      set(null);
    });
  }

  return {
    subscribe,
    /** Set after a successful login / 2FA. */
    login(user: SessionUser) {
      sessionEndedMessage.set('');
      resetAuthExpiredNotice();
      set(user);
    },
    /** Clear local session state (does NOT call the logout API). */
    clear() {
      clearSession();
      sessionEndedMessage.set('');
      resetAuthExpiredNotice();
      set(null);
    }
  };
}

export const session = createSession();
