/// <reference types="@vite-pwa/sveltekit" />

// Minimal type surface for the virtual modules provided by @vite-pwa/sveltekit,
// so `svelte-check` stays clean when we import them in the root layout.
declare module 'virtual:pwa-info' {
  export interface PwaInfo {
    /** The <link rel="manifest"> tag (as an HTML string) to inject into <head>. */
    webManifest: {
      href: string;
      useCredentials: boolean;
      linkTag: string;
    };
    pwaInDevEnvironment: boolean;
  }
  export const pwaInfo: PwaInfo | undefined;
}

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
