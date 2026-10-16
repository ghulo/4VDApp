interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Only there inside the Windows app (desktop/src/preload.js). */
interface Window {
  fourvdDesktop?: { setTheme(preference: 'light' | 'dark' | 'system'): void };
}
