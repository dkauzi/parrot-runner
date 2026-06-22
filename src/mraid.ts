/**
 * MRAID is the ad-network API a playable talks to inside an SDK webview. The CTA must fire
 * through mraid.open(storeUrl), never a plain link. In standalone/dev there is no SDK, so we
 * install a stub that logs and falls back to window.open. The headless test also stubs mraid to
 * assert the CTA fired. This makes the build production-shaped without a live SDK.
 */

interface Mraid {
  open(url: string): void;
  isViewable(): boolean;
  getState(): string;
  addEventListener(e: string, cb: () => void): void;
  removeEventListener(e: string, cb: () => void): void;
}

declare global {
  interface Window {
    mraid?: Mraid;
    __cta?: string[];
    __supportsFastEnd?: boolean;
  }
}

export function ensureMraid(): void {
  if (window.mraid) return;
  window.__cta = window.__cta ?? [];
  window.mraid = {
    open: (url: string) => {
      window.__cta!.push(url);
      // eslint-disable-next-line no-console
      console.log('[mraid stub] open', url);
      try {
        window.open(url, '_blank');
      } catch {
        /* sandboxed preview: logging the call is enough */
      }
    },
    isViewable: () => true,
    getState: () => 'default',
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

const STORE_URL = 'https://example.com/get-the-app';

/** Fire the install CTA the way a real playable does. */
export function fireCta(): void {
  // Explicit guard (not optional chaining) so the call survives minification as `mraid.open(`,
  // which keeps the build validator's CTA check honest.
  if (window.mraid) window.mraid.open(STORE_URL);
}
