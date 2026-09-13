declare global {
  namespace App {}
  interface Window {
    google?: any;
    dataLayer?: unknown[];
  }
}

export {};
